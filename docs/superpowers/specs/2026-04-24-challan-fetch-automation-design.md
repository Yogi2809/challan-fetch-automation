# Challan Fetch Automation — Design Document

**Date:** 2026-04-24  
**Project:** fetch-challan-info-automation  
**Author:** Yogesh Mishra  
**Status:** Approved for Implementation

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [High-Level Design (HLD)](#high-level-design-hld)
   - [System Context](#system-context)
   - [Architecture Diagram](#architecture-diagram)
   - [Phase 1 vs Phase 2](#phase-1-vs-phase-2)
   - [Key Design Decisions](#key-design-decisions)
4. [Low-Level Design (LLD)](#low-level-design-lld)
   - [Frontend (React Stepper UI)](#frontend-react-stepper-ui)
   - [Backend (Node.js + Express)](#backend-nodejs--express)
   - [Session Management](#session-management)
   - [Queue & Worker (BullMQ + Redis)](#queue--worker-bullmq--redis)
   - [Playwright Automation Core](#playwright-automation-core)
   - [Deduplication Logic](#deduplication-logic)
   - [Blank Penalty Amount Lookup](#blank-penalty-amount-lookup)
   - [Reassignment Handling](#reassignment-handling)
   - [Error Handling & Retry Strategy](#error-handling--retry-strategy)
   - [Data Models](#data-models)
   - [API Contracts](#api-contracts)
   - [Storage](#storage)
   - [Alerting](#alerting)
   - [Environment Config](#environment-config)
5. [Scale Considerations](#scale-considerations)
6. [Trade-off Analysis](#trade-off-analysis)
7. [Future Work (Phase 2)](#future-work-phase-2)

---

## Overview

This system automates the fetching of traffic challan (violation notice) data from the **Delhi Traffic Police website** (`traffic.delhipolice.gov.in`) for vehicles undergoing inspection. A QC (Quality Check Associate) triggers the automation manually via a stepper UI, and the system scrapes, deduplicates, and posts the challan data back to the internal Admin Panel.

---

## Goals & Non-Goals

### Goals
- Automate challan data retrieval from Delhi Traffic Police website
- Support multiple QCs working in parallel without session collision
- Deduplicate challan entries before posting to Admin Panel
- Handle mobile number change, OTP submission, and data scraping end-to-end
- Be fully flexible for Phase 2 (backend service trigger, no manual appointmentId entry)
- Production-ready at 5000+ jobs/day with proxy rotation

### Non-Goals
- Automating payment of challans
- Building the Admin Panel itself (external system)
- Automating OTP delivery/reading (manual entry for now)
- Handling non-Delhi traffic challans

---

## High-Level Design (HLD)

### System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Systems                            │
│                                                                     │
│   Admin Panel (c24svc.app)          Delhi Traffic Police Website    │
│   - Stores appointments             - Source of challan data        │
│   - Stores challan results          - Requires browser automation   │
│   - GET/POST API endpoints          - OTP-protected mobile change   │
└────────────┬────────────────────────────────────┬───────────────────┘
             │ GET vehicle details                │ Playwright
             │ POST challan results               │ browser automation
             ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Challan Fetch Automation System                  │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐  │
│  │  React UI   │◄──►│  Node.js     │◄──►│  Playwright Worker     │  │
│  │  (Stepper)  │    │  Backend     │    │  (Browser Automation)  │  │
│  └─────────────┘    │  (Express +  │    └────────────────────────┘  │
│                     │  WebSocket)  │                                │
│                     └──────┬───────┘                                │
│                            │                                        │
│                     ┌──────▼───────┐    ┌────────────────────────┐  │
│                     │  BullMQ      │    │  MongoDB               │  │
│                     │  Queue       │    │  (Job state + history) │  │
│                     │  (Redis)     │    └────────────────────────┘  │
│                     └─────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│  S3 (Images +           │
│  Page Screenshots)      │
└─────────────────────────┘
```

### Architecture Diagram

```
QC opens browser tab
        │
        ▼
React Stepper UI
  Step 1: Enter appointmentId → POST /api/job/start
        │
        ▼
Express Backend
  → Calls Admin Panel GET API → fetches vehicle details
    (registrationNumber, chassisNumber, engineNumber)
  → Creates sessionId (UUID)
  → Pushes job to BullMQ queue
  → Opens WebSocket channel on sessionId
        │
        ▼
  Step 2: Enter user's mobile number → POST /api/job/:sessionId/mobile
        │
        ▼
BullMQ Worker picks up job
  → Opens Playwright browser (fresh session)
  → Opens https://traffic.delhipolice.gov.in/notice/pay-notice
  → Enters registrationNumber
  → Always performs mobile change (fresh session = first visit)
      - Enters new mobile number
      - Enters last 4 of chassisNumber
      - Enters last 4 of engineNumber
      - Submits
      [retry up to 3x on failure, backoff 2s/4s/8s]
      [on total failure → emit MANUAL_INTERVENTION_REQUIRED]
  → Emits WS event: "otp_needed"
        │
        ▼
  Step 3: QC enters OTP → POST /api/job/:sessionId/otp
        │
        ▼
Worker continues
  → Submits OTP
  → Scrapes all challan rows
  → For each row with blank penaltyAmount + blank printNotice:
      → Case-insensitive lookup in offence-amounts.xlsx
      → Sets amountSource = "xlsx_lookup" or "manual_lookup_needed"
  → Downloads offence image per row (View Image)
  → Takes full page screenshot
  → Uploads images + screenshot to S3
  → GET Admin Panel /challan?appointmentId=X (fetch existing)
  → Deduplicate by noticeNo
  → POST only new entries to Admin Panel
  → Emits WS event: "complete"
        │
        ▼
  Step 4: Results displayed to QC
```

### Phase 1 vs Phase 2

| Aspect | Phase 1 (Now) | Phase 2 (Future) |
|---|---|---|
| **appointmentId source** | QC enters manually in Step 1 | Auto-provided by assignment webhook |
| **Trigger** | QC clicks "Start" in UI | Webhook fires on assignment |
| **Mobile number** | QC enters in Step 2 | QC still enters (or SMS auto-read) |
| **OTP** | QC enters in Step 3 | QC still enters (or SMS auto-read) |
| **Automation core** | Unchanged | Unchanged |
| **InputProvider** | `ManualInputProvider` | `WebhookInputProvider` |

The `InputProvider` interface is the **only thing that changes** between phases. All automation logic beneath it stays identical.

### Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| **Trigger mechanism** | Webhook → Queue → Worker | Real-time + reliable retry, decoupled |
| **Queue** | BullMQ + Redis | Built-in retry, concurrency control, Bull Board UI |
| **Browser automation** | Playwright | Most reliable for modern SPAs, good selector API |
| **Session isolation** | UUID sessionId per job | Prevents OTP routing to wrong QC's job |
| **Mobile change** | Always on fresh session | Fresh browser = first visit, mandatory change |
| **Deduplication key** | noticeNo | Unique per challan on Delhi Police site |
| **Reassignment** | New MongoDB entry | Full audit trail, enables active session kill |
| **Alerting** | Slack webhook | Immediate dev notification for broken selectors |
| **Image storage** | S3 | Scalable, public URLs, cheap at volume |

---

## Low-Level Design (LLD)

### Frontend (React Stepper UI)

**Stack:** React 18 + Vite + TailwindCSS

**Component Tree:**
```
App
└── StepperWizard (manages currentStep, sessionId, jobStatus)
    ├── Step1_AppointmentId
    │   └── Input: appointmentId
    │   └── Button: "Fetch Details"
    │   └── Calls: POST /api/job/start
    │
    ├── Step2_MobileNumber
    │   └── Shows: vehicle reg number (confirmation)
    │   └── Input: mobileNumber
    │   └── Button: "Start Automation"
    │   └── Calls: POST /api/job/:sessionId/mobile
    │
    ├── Step3_OTPAndStatus
    │   └── LiveStatusLog (WebSocket events)
    │       ├── ✓ Opened Delhi Police website
    │       ├── ✓ Entered registration number
    │       ├── ✓ Mobile number change submitted
    │       └── ⏳ Waiting for OTP...
    │   └── OTPInput (shown only after "otp_needed" WS event)
    │   └── Button: "Submit OTP"
    │   └── ErrorState (shown on MANUAL_INTERVENTION_REQUIRED)
    │       ├── Button: "Try Again" → POST /api/job/:sessionId/retry
    │       └── Button: "Mark as Manual" → POST /api/job/:sessionId/manual
    │
    └── Step4_Results
        └── ChallanTable (all scraped challans)
        └── PageScreenshotLink
        └── Button: "Start New Job"
```

**WebSocket Events (backend → frontend):**

| Event | Payload | Triggers |
|---|---|---|
| `step_update` | `{ step: string, status: "success"\|"running"\|"failed" }` | Status log update |
| `otp_needed` | `{}` | Show OTP input field |
| `complete` | `{ challans: [...] }` | Move to Step 4 |
| `error` | `{ type: "site_down"\|"selector_broken"\|"mobile_change_failed", message: string }` | Show error state |
| `reassigned` | `{}` | Show "This job has been reassigned" |

---

### Backend (Node.js + Express)

**Stack:** Node.js 20 + Express + Socket.io + BullMQ

**Route Structure:**
```
POST   /api/job/start                    → create job, return sessionId
POST   /api/job/:sessionId/mobile        → attach mobile to job, enqueue worker
POST   /api/job/:sessionId/otp           → forward OTP to waiting Playwright instance
POST   /api/job/:sessionId/retry         → re-queue failed job
POST   /api/job/:sessionId/manual        → mark job as manually handled
GET    /api/job/:sessionId/status        → poll job state (fallback if WS drops)
```

**Startup sequence:**
```javascript
// 1. Load offence lookup table into memory
const offenceLookup = loadOffenceSheet('./data/offence-amounts.xlsx')

// 2. Connect to Redis
const queueConnection = new Redis(process.env.REDIS_URL)

// 3. Start BullMQ worker pool
startWorkerPool(WORKER_CONCURRENCY, offenceLookup)

// 4. Start Express + Socket.io server
app.listen(PORT)
```

---

### Session Management

Each QC session is identified by a `sessionId` (UUID v4) created at job start. This ID:

- Tags the BullMQ job
- Scopes the WebSocket room (`socket.join(sessionId)`)
- Is used to route OTP input to the correct Playwright instance
- Is stored in MongoDB alongside the job record

**OTP routing mechanism:**
```javascript
// Worker registers a resolver when it reaches OTP step
const otpResolvers = new Map() // sessionId → resolve function

// Worker waits:
const otp = await new Promise((resolve) => {
  otpResolvers.set(sessionId, resolve)
})

// Route handler receives OTP from QC:
app.post('/api/job/:sessionId/otp', (req, res) => {
  const resolve = otpResolvers.get(req.params.sessionId)
  resolve(req.body.otp)
  otpResolvers.delete(req.params.sessionId)
})
```

---

### Queue & Worker (BullMQ + Redis)

**Queue config:**
```javascript
const challanQueue = new Queue('challan-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  }
})
```

**Worker concurrency:**

| Environment | `WORKER_CONCURRENCY` |
|---|---|
| Local/Testing | 5 |
| Staging | 10 |
| Production | 25 |

**Job payload:**
```javascript
{
  sessionId: "uuid",
  appointmentId: "APT-001",
  mobileNumber: "98XXXXXXXX",
  vehicleDetails: {
    registrationNumber: "DL3CCL7796",
    chassisNumber: "MALC181CLHM222502",  // last 4: 2502
    engineNumber: "G4FGGW592698"         // last 4: 2698
  },
  assignedTo: "qc-a@company.com",
  createdAt: "ISO timestamp"
}
```

---

### Playwright Automation Core

**File:** `worker/automation.js`

**Steps with WS emissions:**

```
1. openDelhiPoliceWebsite()
   → emit: { step: "open_website", status: "success" }

2. enterRegistrationNumber(registrationNumber)
   → emit: { step: "enter_reg", status: "success" }

3. changeMobileNumber(mobile, chassisLast4, engineLast4)
   → emit: { step: "mobile_change", status: "running" }
   → on success: emit { step: "mobile_change", status: "success" }
   → on failure: retry up to 3x (backoff 2s, 4s, 8s)
   → on total failure: emit { type: "mobile_change_failed" }
                       → job marked FAILED, QC sees error UI

4. waitForOTP()
   → emit: "otp_needed"
   → await otpResolvers.get(sessionId) Promise

5. submitOTP(otp)
   → emit: { step: "otp_submit", status: "success" }

6. scrapeChallanRows()
   → for each row: scrape all visible fields
   → for each row: downloadOffenceImage() → upload to S3

7. takePageScreenshot()
   → upload to S3 → get public URL

8. resolveBlankAmounts(rows, offenceLookup)
   → case-insensitive lookup for rows with blank penaltyAmount + printNotice

9. deduplicateAndPost(rows, appointmentId)
   → GET Admin Panel existing challans
   → filter rows where noticeNo not in existing set
   → POST new rows to Admin Panel

10. emit: "complete", { challans: finalRows }
    → job marked COMPLETED in MongoDB
```

**Selector failure detection:**
```javascript
async function safeFind(page, selector, stepName) {
  try {
    await page.waitForSelector(selector, { timeout: 10000 })
  } catch (e) {
    const screenshot = await page.screenshot()
    await uploadToS3(screenshot, `errors/${sessionId}-${stepName}.png`)
    await sendSlackAlert({
      message: `Selector broken at step: ${stepName}`,
      selector,
      screenshotUrl,
      appointmentId,
    })
    throw new SelectorBrokenError(stepName)
  }
}
```

---

### Deduplication Logic

```javascript
async function deduplicateAndPost(scrapedChallans, appointmentId) {
  // 1. Fetch existing
  const existing = await adminPanelGet(`/challan?appointmentId=${appointmentId}`)
  const existingNoticeNos = new Set(existing.map(c => c.noticeNo))

  // 2. Filter
  const newChallans = scrapedChallans.filter(
    c => !existingNoticeNos.has(c.noticeNo)
  )

  // 3. Post only new
  if (newChallans.length === 0) return // nothing to post

  await adminPanelPost('/challan', {
    appointmentId,
    challans: newChallans,
  })
}
```

---

### Blank Penalty Amount Lookup

```javascript
// Loaded once at startup
function loadOffenceSheet(filePath) {
  const df = readXlsx(filePath) // sheet: IDFY
  const lookup = new Map()
  for (const row of df) {
    if (row.OFFENCE_NAME && row.AMOUNT) {
      lookup.set(row.OFFENCE_NAME.toLowerCase().trim(), row.AMOUNT)
    }
  }
  return lookup
}

// Used per blank-amount challan row
function lookupOffenceAmount(offenceDetail, lookup) {
  const needle = offenceDetail.toLowerCase().trim()

  // 1. Exact match
  if (lookup.has(needle)) {
    return { amount: lookup.get(needle), source: 'xlsx_lookup' }
  }

  // 2. Partial match (scraped contains sheet entry OR sheet entry contains scraped)
  for (const [key, amount] of lookup) {
    if (needle.includes(key) || key.includes(needle)) {
      return { amount, source: 'xlsx_lookup' }
    }
  }

  // 3. No match
  return { amount: null, source: 'manual_lookup_needed' }
}
```

---

### Reassignment Handling

**MongoDB entry on reassignment:**
```javascript
// New entry always created (never overwrite)
{
  _id: ObjectId,
  appointmentId: "APT-001",
  assignedTo: "qc-b@company.com",
  status: "pending",
  previousSessionId: "uuid-of-qc-a-session",  // for audit
  createdAt: ISODate,
}
```

**Active session termination:**
```javascript
async function handleReassignment(appointmentId, newAssignee) {
  // 1. Find active session for this appointmentId
  const activeJob = await JobRecord.findOne({
    appointmentId,
    status: 'in_progress'
  })

  if (activeJob) {
    // 2. Kill Playwright instance
    await terminateSession(activeJob.sessionId)

    // 3. Notify displaced QC via WebSocket
    io.to(activeJob.sessionId).emit('reassigned', {
      message: 'This job has been reassigned to another QC.'
    })

    // 4. Mark old session as reassigned
    await JobRecord.updateOne(
      { sessionId: activeJob.sessionId },
      { status: 'reassigned' }
    )
  }

  // 5. Create new MongoDB entry for new QC
  await JobRecord.create({
    appointmentId,
    assignedTo: newAssignee,
    status: 'pending',
    previousSessionId: activeJob?.sessionId,
  })
}
```

---

### Error Handling & Retry Strategy

| Error Type | Detection | Action |
|---|---|---|
| Mobile change failed | Form submission error / wrong confirmation | Retry 3x (2s/4s/8s backoff), then show Try Again / Mark as Manual |
| Site temporarily down | HTTP timeout / connection refused | Auto-retry with delay (2min/5min/10min), then alert QC |
| Selector broken | `waitForSelector` timeout on live site | Fail fast, Slack alert + screenshot, pause ALL pending jobs |
| OTP timeout | QC doesn't submit within 10 minutes | Job marked failed, session cleaned up |
| Reassignment mid-job | New MongoDB entry detected | Kill active session, notify QC-A, QC-B starts fresh |

---

### Data Models

**JobRecord (MongoDB):**
```javascript
{
  _id: ObjectId,
  sessionId: String (UUID),           // unique per run
  appointmentId: String,
  assignedTo: String,                 // QC email
  previousSessionId: String | null,   // set on reassignment
  status: Enum[
    'pending',
    'in_progress',
    'completed',
    'failed',
    'manual',
    'reassigned'
  ],
  vehicleDetails: {
    registrationNumber: String,
    chassisNumber: String,
    engineNumber: String,
  },
  mobileNumber: String,
  createdAt: Date,
  updatedAt: Date,
  completedAt: Date | null,
  errorDetails: String | null,
}
```

**ChallanResult (posted to Admin Panel):**
```javascript
{
  appointmentId: String,
  fetchedBy: String,                  // QC email
  fetchedAt: ISOString,
  pageScreenshotUrl: String,          // S3 URL of full pay-notice page
  challans: [
    {
      noticeNo: String,               // unique identifier
      vehicleNumber: String,
      offenceDateTime: String,
      offenceLocation: String,
      offenceDetail: String,
      offenceImageUrl: String | null, // S3 URL of View Image download
      penaltyAmount: Number | null,
      amountSource: Enum['scraped', 'xlsx_lookup', 'manual_lookup_needed'],
      status: String,                 // e.g. "Sent to Virtual Court"
      challanCourt: String | null,    // e.g. "Virtual Court"
      makePayment: String | null,
      verifyPayment: String | null,
      grievances: String | null,
      printNotice: String | null,
    }
  ]
}
```

---

### API Contracts

#### External APIs (Third-Party / Admin Panel)

> ⚠️ **All endpoints and API keys below are STAGING only — for testing and development purposes.**
> Production endpoints and keys will be different and must be injected via environment variables / secrets manager.
> Never hardcode these values in source code.

---

**1. GET Appointment Details**
> Fetches unmasked vehicle details (reg no, chassis, engine) for a given appointment.

```
GET https://oms-purchase-stage.qac24svc.dev/api/order/{{appointmentId}}
Headers:
  x-api-key: PcLHVSx97orSVxWqIS0yExFwjVP29EY1
```

**Expected response fields used:**
| Field | Used For |
|---|---|
| `registrationNumber` | Entered into Delhi Police website search |
| `chassisNumber` | Last 4 digits used in mobile change verification |
| `engineNumber` | Last 4 digits used in mobile change verification |

---

**2. POST Create Challan**
> Saves one scraped challan entry back to the Admin Panel. Called once per new challan row (after deduplication).

```
POST https://challan-service-stage.qac24svc.dev/api/customer-challan/create
Headers:
  x-api-key: Y2hhbGxhbi1zZXJ2aWNlLXN0YWdl
Content-Type: multipart/form-data

Form fields:
  appointmentId   string    "APT-XXXXX"
  challanName     string    offence description (from scraped row)
  challanType     string    "ONLINE"  (always)
  noticeNumber    string    unique notice no. from scraped row
  amount          string    penalty amount (scraped or xlsx-looked-up)
  createdBy       string    QC email address
  offenceDate     string    "YYYY-MM-DD"  (from scraped row)
  challanCourt    string    court name from scraped row
  challanProof    file      offence image (downloaded from police site, uploaded as multipart)
```

> ⚠️ `challanProof` is the offence image **file** (not a URL). The backend must download the image from S3 or temp-store it before POST-ing to this API.

---

**3. GET Existing Challans (Deduplication)**
> Fetches all challans already saved for an appointment. Used to determine which scraped rows are NEW before calling Create.

```
GET https://oms-purchase-stage.qac24svc.dev/api/order/challan/detail/{{appointmentId}}
Headers:
  x-api-key: PcLHVSx97orSVxWqIS0yExFwjVP29EY1
```

**Deduplication key:** `noticeNumber` (unique per challan)

```javascript
// Usage in deduplication logic
const existing    = await getExistingChallans(appointmentId);
const existingNos = new Set(existing.map(c => c.noticeNumber));
const newRows     = scrapedRows.filter(r => !existingNos.has(r.noticeNo));
// POST only newRows — skip if empty
```

---

#### Internal APIs (Our Backend — Express Routes)

**POST /api/job/start**
```
Request:  { appointmentId: string }
Response: { sessionId: string, vehicleDetails: { registrationNumber, chassisNumber, engineNumber } }
```

**POST /api/job/:sessionId/mobile**
```
Request:  { mobileNumber: string }
Response: { status: "queued" }
```

**POST /api/job/:sessionId/otp**
```
Request:  { otp: string }
Response: { status: "submitted" }
```

**POST /api/job/:sessionId/retry**
```
Request:  {}
Response: { status: "requeued" }
```

**POST /api/job/:sessionId/manual**
```
Request:  {}
Response: { status: "marked_manual" }
```

---

### Storage

| Environment | Image Storage | Page Screenshot | XLSX Offence Sheet |
|---|---|---|---|
| Local/Testing | Local filesystem (`/uploads`) | Local filesystem | `backend/data/offence-amounts.xlsx` |
| Production | AWS S3 (`challan-images` bucket) | AWS S3 | Same file, loaded at startup |

S3 files are uploaded with **public-read ACL** so Admin Panel can display them inline.

---

### Alerting

**Slack alert payload:**
```javascript
{
  text: "🚨 Challan Automation — Selector Broken",
  blocks: [
    { type: "section", text: "Step: mobile_change\nSelector: #changeNumberBtn\nAppointmentId: APT-001" },
    { type: "image", image_url: "https://s3.../error-screenshot.png", alt_text: "Page screenshot" },
    { type: "section", text: "⚠️ All pending jobs have been paused. Dev action required." }
  ]
}
```

Sent to: `process.env.SLACK_WEBHOOK_URL`

---

### Environment Config

```bash
# .env.test  ← use this for local development & testing
NODE_ENV=test
PORT=3001

# ── External API — Appointment Details ─────────────────────────────
OMS_BASE_URL=https://oms-purchase-stage.qac24svc.dev
OMS_API_KEY=PcLHVSx97orSVxWqIS0yExFwjVP29EY1

# ── External API — Challan Service ─────────────────────────────────
CHALLAN_SERVICE_BASE_URL=https://challan-service-stage.qac24svc.dev
CHALLAN_SERVICE_API_KEY=Y2hhbGxhbi1zZXJ2aWNlLXN0YWdl

# ── Infrastructure ──────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/challan-test

# ── Storage (local for test, S3 for staging+prod) ──────────────────
STORAGE_MODE=local           # "local" | "s3"
LOCAL_UPLOAD_DIR=./uploads
AWS_BUCKET=challan-images-staging
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# ── Automation ──────────────────────────────────────────────────────
WORKER_CONCURRENCY=2
OTP_TIMEOUT_MS=600000        # 10 minutes
PLAYWRIGHT_HEADLESS=false    # true in CI/prod, false for local debugging

# ── Alerting ────────────────────────────────────────────────────────
SLACK_WEBHOOK_URL=           # leave blank for local test

# ── Test vehicle (from RC card — RJ14CV8337) ───────────────────────
TEST_APPOINTMENT_ID=         # fill with a real staging appointmentId
TEST_MOBILE_NUMBER=          # fill with the vehicle owner's mobile


# .env.staging
NODE_ENV=staging
PORT=3000
OMS_BASE_URL=https://oms-purchase-stage.qac24svc.dev
OMS_API_KEY=PcLHVSx97orSVxWqIS0yExFwjVP29EY1
CHALLAN_SERVICE_BASE_URL=https://challan-service-stage.qac24svc.dev
CHALLAN_SERVICE_API_KEY=Y2hhbGxhbi1zZXJ2aWNlLXN0YWdl
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/challan-staging
STORAGE_MODE=s3
AWS_BUCKET=challan-images-staging
AWS_REGION=ap-south-1
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
WORKER_CONCURRENCY=5
OTP_TIMEOUT_MS=600000
PLAYWRIGHT_HEADLESS=true

# .env.production
NODE_ENV=production
PORT=3000
OMS_BASE_URL=https://oms-purchase.qac24svc.dev        # update to prod URL
OMS_API_KEY=                                           # prod key — fill when ready
CHALLAN_SERVICE_BASE_URL=https://challan-service.qac24svc.dev
CHALLAN_SERVICE_API_KEY=                               # prod key — fill when ready
REDIS_URL=redis://...                                  # managed Redis
MONGODB_URI=mongodb+srv://...                          # MongoDB Atlas
STORAGE_MODE=s3
AWS_BUCKET=challan-images-prod
AWS_REGION=ap-south-1
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
WORKER_CONCURRENCY=25
OTP_TIMEOUT_MS=600000
PLAYWRIGHT_HEADLESS=true
```

---

## Scale Considerations

| Metric | Testing | Production |
|---|---|---|
| Jobs/day | 100–500 | 5000+ |
| Concurrent QCs | 5–10 | 20–30 |
| Playwright instances | 5–10 | 25–30 |
| RAM required | ~2GB | ~8–10GB |
| Redis | Local | Managed (Redis Cloud / Upstash) |
| MongoDB | Local | MongoDB Atlas |
| IP blocking risk | Low | High → **proxy rotation required** |
| Proxy recommendation | Not needed | Bright Data / Oxylabs residential proxies |

**Proxy integration point:**
```javascript
// In worker/automation.js
const browser = await playwright.chromium.launch({
  proxy: process.env.PROXY_URL
    ? { server: process.env.PROXY_URL }
    : undefined
})
```

`PROXY_URL` is unset in staging, set to rotating proxy endpoint in production.

---

## Trade-off Analysis

| Decision | Trade-off |
|---|---|
| **BullMQ over simple HTTP queue** | More setup (Redis needed) vs built-in retry, concurrency, visibility |
| **WebSocket over polling** | Slight complexity vs real-time OTP step coordination |
| **New MongoDB entry on reassignment** | More storage vs full audit trail + reassignment detection |
| **Always change mobile (fresh session)** | Extra step every time vs correctness guarantee |
| **XLSX loaded at startup** | Stale if file changes vs no per-request disk I/O |
| **Manual OTP at 5000/day** | Human bottleneck at scale vs reliable, no SMS gateway cost |

---

## Future Work (Phase 2)

1. **WebhookInputProvider** — replace `ManualInputProvider`, remove Step 1 from UI
2. **SMS auto-read** — integrate MSG91/2Factor to auto-fill OTP, remove Step 3 manual entry
3. **Proxy rotation** — add residential proxy pool for production IP rotation
4. **Bull Board** — add job monitoring dashboard at `/admin/queues`
5. **Production Admin Panel URL** — fill `ADMIN_PANEL_URL` in `.env.production`
6. **Multi-city expansion** — abstract Delhi Police site into a `CityTrafficProvider` interface for other states
