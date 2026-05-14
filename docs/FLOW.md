# Challan Fetch Automation — Complete System Flow

## Overview

Automates challan lookup from 9 Indian traffic portals for vehicles under QC inspection.  
A QC operator enters an appointment ID; the system handles website navigation, CAPTCHAs, and data submission autonomously.

---

## Architecture at a Glance

```
React Stepper UI  ↔  Node.js + Express  →  BullMQ + Redis  →  Playwright Workers
                         ↓                                           ↓
                      MongoDB                          9 Traffic Portal Scrapers
                         ↕                                           ↓
                      OMS API                              CAPTCHA Auto-Solver
                      (GET vehicle + existing challans)    (S3 → AI Webhook)
                         ↕
                   Challan Service
                   (POST new rows)
```

---

## Scraper Roster

| Scraper | Site | CAPTCHA | OTP | Notes |
|---|---|---|---|---|
| Delhi | traffic.delhipolice.gov.in | No | **Yes** | Requires mobile number change |
| MP | echallan.mponline.gov.in | **Yes (auto)** | No | Vue-rendered form |
| Jharkhand | echallan.jhpolice.gov.in | **Yes (auto)** | No | Form POST navigation |
| Telangana | echallan.tspolice.gov.in | **Yes (auto)** | No | SweetAlert modal on wrong |
| Kerala | payment.keralapolice.gov.in | No | No | Manual run only; JSF/RichFaces; 2–5 min latency |
| Rajkot | e-challan portal | No | No | — |
| Surat | e-challan portal | No | No | — |
| Vadodara | e-challan portal | No | No | — |
| West Bengal | e-challan portal | No | No | — |

---

## End-to-End Flow

### Step 1 — Appointment ID
1. QC types `appointmentId` in the Stepper UI.
2. Backend calls **OMS API** `GET /api/order/:appointmentId` (key: `OMS_API_KEY`).
3. Returns `{ registrationNumber, chassisNumber, engineNumber }`.
4. Backend creates a MongoDB document `{ sessionId: uuid, status: pending, vehicleDetails, assignedTo }`.
5. WebSocket channel opened for this `sessionId`.

### Step 2 — Queue Job
1. QC enters mobile number (for Delhi OTP flow) and clicks Submit.
2. Backend pushes job to **BullMQ + Redis**; MongoDB status → `in_progress`.
3. A Playwright worker picks up the job.

### Step 3 — Scraper Runs (per portal)

Each scraper receives `{ page, context: { registrationNumber, sessionId }, helpers: { emitStatus, onCaptchaRequired } }`.

#### 3a — Simple scrapers (Rajkot, Surat, Vadodara, West Bengal)
- Navigate → fill registration number → submit → parse table → return rows.

#### 3b — CAPTCHA scrapers (MP, Jharkhand, Telangana)

```
solveCaptchaAuto() loop (max 3 attempts):
  1. captureBuffer()     → screenshot CAPTCHA element → Buffer
  2. solveCaptchaWithAI(buffer, sessionId):
       a. Upload buffer to S3: challan-fetch-automation/captcha/{sessionId}/{ts}.jpg
       b. Generate pre-signed GET URL (TTL 300s)
       c. POST https://weave.c24.tech/api/v1/execution/.../run
            headers: Authorization: Bearer <token>, team-id: <id>
            body: { input_data: { url: presignedUrl } }
       d. Parse response: final_output.results[firstKey].value → "bmanm"
       e. Delete S3 object (cleanup)
  3. fillAndSubmit(value)  → fill captcha input + click submit + wait for navigation
  4. checkOutcome()        → 'found' | 'wrong_captcha' | 'no_challans'
  5. If wrong → onWrongCaptcha() → reload/reset → retry
  6. If 3 attempts exhausted → humanFallback() → existing manual UI flow

AWS credentials: fromSSO({ profile: 'Cars24NonprodYogeshMishra' })
  - 6-hour IAM tokens auto-refreshed from SSO cache (~/.aws/sso/cache)
  - When SSO session expires (8–24h): aws sso login --profile Cars24NonprodYogeshMishra
```

#### 3c — Delhi (OTP flow)
1. Navigate → fill registration number → click Search.
2. `changeMobileNumber()` — always runs on fresh session (up to 3× retry, backoff 2s→4s→8s).
3. `waitForOTP()` — emits `otp_needed` via WebSocket → QC enters OTP in UI → promise resolves.
4. Submit OTP → scrape.

#### 3d — Kerala (manual/slow)
- Marked `isManual = true`; runs on-demand only.
- JSF/RichFaces portal; `[id="frmdata:regno"]` input, `[id="frmdata:ep"]` button.
- Results table wait timeout: 5 minutes.
- No CAPTCHA, no OTP.

### Step 4 — Data Extraction (all scrapers)
Fields collected per challan row:
- `noticeNo` — unique dedup key
- `offenceDetail` — offence description
- `penaltyAmount` — may be 0/blank
- `offenceDate` — YYYY-MM-DD
- `challanType` — ONLINE or OFFLINE
- `challanCourt` — scraper-specific constant
- `status` — only Pending rows are kept; Settled/Paid are dropped
- `imageBuffer` — screenshot of the challan page (JPEG)

### Step 5 — XLSX Penalty Lookup
If `penaltyAmount` is 0 or blank:
1. Look up `offenceDetail` in `backend/data/offences.xlsx` (198 rows, loaded at startup).
2. Case-insensitive exact match → use value.
3. If no match → `amountSource = 'manual_lookup_needed'`.

### Step 6 — Deduplication
1. Call **OMS API** `GET /api/order/challan/detail/:appointmentId` → existing `noticeNumber` list.
2. Filter: keep only rows where `noticeNo` not already in the admin panel.

### Step 7 — POST to Challan Service
For each new challan row:
```
POST /api/customer-challan/create   (challan-service-stage.qac24svc.dev)
Content-Type: multipart/form-data
Fields:
  appointmentId, challanName, challanType, noticeNumber,
  amount, createdBy (QC email), offenceDate, challanCourt,
  challanProof  ← JPEG imageBuffer (file, not URL)
```

### Step 8 — Completion
1. MongoDB doc → `status: completed`, `completedAt`, `result: { challans, pageScreenshotUrl }`.
2. WebSocket emits `complete { challans: finalRows }`.
3. Playwright session closed.
4. UI shows challan table with submit button.

---

## QC Submission (Manual Step)

After automation, the QC reviews the consolidated "Pending Challans" tab and clicks **Submit All**.  
The frontend calls `POST /api/job/:sessionId/submit` for each session, polls for `status: submitted`,
and shows final results.

---

## CAPTCHA Auto-Solver — Credential Rotation

| Scenario | Behaviour |
|---|---|
| Normal operation (< 6h) | `fromSSO()` uses cached IAM token — no action needed |
| 6-hour IAM token expires | SDK silently fetches new IAM token from SSO cache |
| SSO session expires (8–24h) | Run: `aws sso login --profile Cars24NonprodYogeshMishra` (10 sec) |
| S3 upload fails | Counts as failed attempt; 3 failures → human fallback |
| Webhook non-2xx | Counts as failed attempt |
| `value` missing in response | Counts as failed attempt |
| All 3 auto attempts fail | Falls back to manual CAPTCHA UI (existing operator flow) |

---

## Key Files

| File | Purpose |
|---|---|
| `backend/src/utils/captchaSolver.js` | S3 upload + webhook call + response parsing |
| `backend/src/worker/steps/solveCaptcha.js` | `solveCaptchaAuto()` + `solveCaptcha()` (human fallback) |
| `backend/src/worker/scrapers/mp/index.js` | MP scraper (CAPTCHA auto-solver) |
| `backend/src/worker/scrapers/jharkhand/index.js` | Jharkhand scraper (CAPTCHA auto-solver) |
| `backend/src/worker/scrapers/telangana/index.js` | Telangana scraper (CAPTCHA auto-solver) |
| `backend/src/worker/scrapers/delhi/index.js` | Delhi scraper (OTP flow) |
| `backend/src/worker/scrapers/kerala/index.js` | Kerala scraper (manual, JSF portal) |
| `backend/src/server.js` | Express server, WebSocket, queue management |
| `frontend/src/components/ChallanWizard.jsx` | Main wizard orchestrating all scraper tabs |
| `frontend/src/components/ScraperTabPanel.jsx` | Per-scraper tab: status, CAPTCHA input, results |
| `frontend/src/components/PendingChallansTab.jsx` | Consolidated view + submit to admin panel |
| `backend/src/config.js` | All env var mappings |
| `backend/.env` | Local env (staging only — never commit prod keys) |

---

## Environment Variables (`.env`)

```
# Infrastructure
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/challan-test

# External APIs (staging)
OMS_BASE_URL=https://oms-purchase-stage.qac24svc.dev
OMS_API_KEY=...
CHALLAN_SERVICE_BASE_URL=https://challan-service-stage.qac24svc.dev
CHALLAN_SERVICE_API_KEY=...

# CAPTCHA Auto-Solver
CAPTCHA_WEBHOOK_URL=https://weave.c24.tech/api/v1/execution/.../run
CAPTCHA_WEBHOOK_TOKEN=exec_...
CAPTCHA_WEBHOOK_TEAM_ID=...
CAPTCHA_S3_BUCKET=challan-fetch-automation
AWS_PROFILE=Cars24NonprodYogeshMishra
AWS_REGION=ap-south-1
```

---

## Running Locally

```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev

# Refresh AWS SSO if expired
aws sso login --profile Cars24NonprodYogeshMishra
```
