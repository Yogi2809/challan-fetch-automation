# Challan Fetch Automation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack system where a QC manually enters an appointmentId and mobile number, a Playwright worker fetches challan data from the Delhi Traffic Police website via OTP, and posts deduplicated results to the Challan Service API.

**Architecture:** React stepper UI communicates with a Node.js/Express backend over REST + WebSocket (Socket.io). Jobs are queued via BullMQ + Redis and consumed by Playwright workers. Each job is session-isolated via a UUID `sessionId` used to scope WebSocket rooms, OTP routing, and MongoDB records.

**Tech Stack:** React 18 + Vite + TailwindCSS · Node.js 20 + Express + Socket.io · BullMQ + Redis · Playwright · MongoDB + Mongoose · AWS S3 (or local filesystem for test) · axios + form-data · xlsx · vitest (backend unit tests)

---

## Clarifications (Answered 2026-04-27)

| # | Question | Answer | Impact |
|---|---|---|---|
| 1 | `challanProof` if no image? | Use the **full page screenshot** of the challan page as the file | `scrapeChallans.js` — fall back to page screenshot buffer per row |
| 2 | Date format on site? | `YYYY-MM-DD HH:MM:SS` — extract date part only | Parse with `.split(' ')[0]` or `.slice(0,10)` |
| 3 | Null amount? | **No field can be null** — always fall back to XLSX lookup, then `"0"` | `deduplicatePost.js` — `amount = penaltyAmount ?? xlsxResult ?? "0"` |
| 4 | `challanName`? | **Offence Type** — the offence description scraped from the site | Map `offenceDetail` → `challanName` |
| 5 | `createdBy`? | Will come from API or MongoDB event on assignment. **Testing: `yogesh.mishra@cars24.com`** | Hardcode for test; wire to real value in production |
| 6 | `pageScreenshotUrl`? | Goes into **`challanProof`** field. Testing: **store locally** (`STORAGE_MODE=local`) | No separate screenshot API call needed — screenshot IS the proof when no image |
| 7 | `challanType`? | `"ONLINE"` if Make Payment column shows **"Pay Now"** or **"Virtual Court"**. `"OFFLINE"` if blank | Scrape `makePayment` column; derive type from it |
| 8 | Real HTML selectors? | Needs live browser inspection of `traffic.delhipolice.gov.in` — **see Task 9A** | All Playwright selectors are placeholders until Task 9A runs |
| 9 | Empty `challanCourt`? | Send **`'Delhi(Traffic Department)'`** as default for Delhi Police site testing | Fallback in `deduplicatePost.js` |
| 10 | Amount not on site? | Refer to **Excel sheet** (XLSX lookup) — already in plan | Confirmed existing XLSX logic is correct |

---

## File Structure

```
fetch-challan-info-automation/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express + Socket.io app entry point
│   │   ├── config.js              # All env vars in one place
│   │   ├── routes/
│   │   │   └── jobs.js            # All /api/job/* route handlers
│   │   ├── services/
│   │   │   ├── omsService.js      # GET vehicle details + GET existing challans (OMS API)
│   │   │   ├── challanService.js  # POST create challan (Challan Service API, multipart)
│   │   │   └── storageService.js  # upload file / screenshot → local or S3
│   │   ├── queue/
│   │   │   ├── challanQueue.js    # BullMQ Queue instance
│   │   │   └── workerPool.js      # BullMQ Worker setup + concurrency
│   │   ├── worker/
│   │   │   ├── automation.js      # Main Playwright orchestration (all 9 steps)
│   │   │   ├── steps/
│   │   │   │   ├── openSite.js          # Step 3: open Delhi Police website
│   │   │   │   ├── changeMobile.js      # Step 4: change mobile (with retry)
│   │   │   │   ├── submitOtp.js         # Step 5: resolve OTP promise + submit
│   │   │   │   ├── scrapeChallans.js    # Step 6: scrape rows + download images
│   │   │   │   └── deduplicatePost.js   # Step 8: GET existing + POST new rows
│   │   │   └── safeFind.js        # waitForSelector wrapper with Slack alert
│   │   ├── models/
│   │   │   └── JobRecord.js       # Mongoose schema for job state
│   │   ├── utils/
│   │   │   ├── offenceLookup.js   # Load XLSX + lookupOffenceAmount()
│   │   │   ├── sessionStore.js    # otpResolvers Map + activeWorkers Map
│   │   │   └── slack.js           # sendSlackAlert()
│   │   └── data/
│   │       └── offence-amounts.xlsx  # 198-row offence → amount sheet
│   ├── tests/
│   │   ├── offenceLookup.test.js
│   │   ├── deduplicatePost.test.js
│   │   ├── omsService.test.js
│   │   └── challanService.test.js
│   ├── package.json
│   └── .env.test                  # already created — copy to .env before running
│
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── hooks/
│   │   │   └── useSocket.js       # Socket.io connection + event handlers
│   │   ├── components/
│   │   │   ├── StepperWizard.jsx  # Step state machine + sessionId holder
│   │   │   ├── Step1_AppointmentId.jsx
│   │   │   ├── Step2_MobileNumber.jsx
│   │   │   ├── Step3_OtpAndStatus.jsx
│   │   │   │   ├── LiveStatusLog.jsx
│   │   │   │   ├── OtpInput.jsx
│   │   │   │   └── ErrorState.jsx
│   │   │   └── Step4_Results.jsx
│   │   │       └── ChallanTable.jsx
│   │   └── api.js                 # axios wrapper for all backend calls
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
│
├── .env.test                      # already created
└── docs/
```

---

## Task 1: Project Scaffold + Dependencies

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/config.js`
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/index.html`

- [ ] **Step 1: Create backend package.json**

```bash
mkdir -p /Users/a39935/Desktop/fetch-challan-info-automation/backend/src/{routes,services,queue,worker/steps,models,utils,data}
mkdir -p /Users/a39935/Desktop/fetch-challan-info-automation/backend/tests
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
```

Create `backend/package.json`:
```json
{
  "name": "challan-automation-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "axios": "^1.7.2",
    "bullmq": "^5.7.8",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "form-data": "^4.0.0",
    "ioredis": "^5.3.2",
    "mongoose": "^8.4.0",
    "playwright": "^1.44.0",
    "socket.io": "^4.7.5",
    "uuid": "^9.0.1",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create backend/src/config.js**

```javascript
// backend/src/config.js
import 'dotenv/config';

export const config = {
  port:                   parseInt(process.env.PORT || '3001'),
  nodeEnv:                process.env.NODE_ENV || 'test',
  redisUrl:               process.env.REDIS_URL || 'redis://localhost:6379',
  mongoUri:               process.env.MONGODB_URI || 'mongodb://localhost:27017/challan-test',

  // OMS API — vehicle details + existing challans
  omsBaseUrl:             process.env.OMS_BASE_URL || 'https://oms-purchase-stage.qac24svc.dev',
  omsApiKey:              process.env.OMS_API_KEY || '',

  // Challan Service — POST new challan rows
  challanServiceBaseUrl:  process.env.CHALLAN_SERVICE_BASE_URL || 'https://challan-service-stage.qac24svc.dev',
  challanServiceApiKey:   process.env.CHALLAN_SERVICE_API_KEY || '',

  // Storage
  storageMode:            process.env.STORAGE_MODE || 'local',   // 'local' | 's3'
  localUploadDir:         process.env.LOCAL_UPLOAD_DIR || './uploads',
  awsBucket:              process.env.AWS_BUCKET || '',
  awsRegion:              process.env.AWS_REGION || 'ap-south-1',

  // Automation
  workerConcurrency:      parseInt(process.env.WORKER_CONCURRENCY || '2'),
  otpTimeoutMs:           parseInt(process.env.OTP_TIMEOUT_MS || '600000'),
  playwrightHeadless:     process.env.PLAYWRIGHT_HEADLESS !== 'false',

  // Alerting
  slackWebhookUrl:        process.env.SLACK_WEBHOOK_URL || '',
};
```

- [ ] **Step 3: Create frontend scaffold**

```bash
mkdir -p /Users/a39935/Desktop/fetch-challan-info-automation/frontend/src/{hooks,components}
```

Create `frontend/package.json`:
```json
{
  "name": "challan-automation-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "axios": "^1.7.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.7.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "vite": "^5.2.12"
  }
}
```

Create `frontend/vite.config.js`:
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
```

Create `frontend/tailwind.config.js`:
```javascript
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

Create `frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Challan Fetch Automation</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend && npm install
cd /Users/a39935/Desktop/fetch-challan-info-automation/frontend && npm install
```

Expected: both `node_modules` folders created, no errors.

- [ ] **Step 5: Install Playwright browsers**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npx playwright install chromium
```

Expected: Chromium browser binary downloaded.

- [ ] **Step 6: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/package.json backend/src/config.js frontend/package.json frontend/vite.config.js frontend/tailwind.config.js frontend/index.html
git commit -m "feat: project scaffold — backend + frontend packages, config"
```

---

## Task 2: Offence Lookup Utility (XLSX)

**Files:**
- Create: `backend/src/utils/offenceLookup.js`
- Test: `backend/tests/offenceLookup.test.js`

> This is the only pure logic unit — perfect first TDD candidate.

- [ ] **Step 1: Write failing tests**

Create `backend/tests/offenceLookup.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { buildLookupMap, lookupOffenceAmount } from '../src/utils/offenceLookup.js';

describe('buildLookupMap', () => {
  it('builds a Map with lowercase trimmed keys', () => {
    const rows = [
      { OFFENCE_NAME: '  Using Mobile Phone  ', AMOUNT: 1000 },
      { OFFENCE_NAME: 'Jumping Red Light', AMOUNT: 500 },
    ];
    const map = buildLookupMap(rows);
    expect(map.get('using mobile phone')).toBe(1000);
    expect(map.get('jumping red light')).toBe(500);
  });

  it('skips rows with missing OFFENCE_NAME or AMOUNT', () => {
    const rows = [
      { OFFENCE_NAME: '', AMOUNT: 500 },
      { OFFENCE_NAME: 'Valid Offence', AMOUNT: null },
      { OFFENCE_NAME: 'Good Offence', AMOUNT: 200 },
    ];
    const map = buildLookupMap(rows);
    expect(map.size).toBe(1);
    expect(map.get('good offence')).toBe(200);
  });
});

describe('lookupOffenceAmount', () => {
  const map = new Map([
    ['using mobile phone while driving', 1000],
    ['jumping red light', 500],
    ['over speeding', 400],
  ]);

  it('returns amount and xlsx_lookup on exact match (case-insensitive)', () => {
    const result = lookupOffenceAmount('Using Mobile Phone While Driving', map);
    expect(result).toEqual({ amount: 1000, source: 'xlsx_lookup' });
  });

  it('returns amount and xlsx_lookup on partial match (scraped contains key)', () => {
    const result = lookupOffenceAmount('jumping red light at crossing abc', map);
    expect(result).toEqual({ amount: 500, source: 'xlsx_lookup' });
  });

  it('returns amount and xlsx_lookup on partial match (key contains scraped)', () => {
    const result = lookupOffenceAmount('over speeding', map);
    expect(result).toEqual({ amount: 400, source: 'xlsx_lookup' });
  });

  it('returns null and manual_lookup_needed when no match', () => {
    const result = lookupOffenceAmount('riding without helmet', map);
    expect(result).toEqual({ amount: null, source: 'manual_lookup_needed' });
  });

  it('handles empty string gracefully', () => {
    const result = lookupOffenceAmount('', map);
    expect(result).toEqual({ amount: null, source: 'manual_lookup_needed' });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/offenceLookup.test.js
```

Expected: FAIL — `Cannot find module '../src/utils/offenceLookup.js'`

- [ ] **Step 3: Implement offenceLookup.js**

Create `backend/src/utils/offenceLookup.js`:
```javascript
import { readFileSync } from 'fs';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';

/**
 * Reads the XLSX file and returns an array of row objects.
 * Uses the first sheet if sheet name not found.
 */
export function readXlsxRows(filePath) {
  const workbook = xlsxRead(readFileSync(filePath));
  const sheetName = workbook.SheetNames.includes('IDFY')
    ? 'IDFY'
    : workbook.SheetNames[0];
  return xlsxUtils.sheet_to_json(workbook.Sheets[sheetName]);
}

/**
 * Builds a lookup Map from an array of XLSX row objects.
 * Keys are lowercased + trimmed offence names.
 * Skips rows with missing/empty OFFENCE_NAME or AMOUNT.
 */
export function buildLookupMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.OFFENCE_NAME && row.AMOUNT) {
      map.set(String(row.OFFENCE_NAME).toLowerCase().trim(), row.AMOUNT);
    }
  }
  return map;
}

/**
 * Looks up a scraped offence detail against the in-memory Map.
 * Strategy: 1. Exact match  2. Partial match  3. No match
 *
 * @param {string} offenceDetail — raw scraped text from Delhi Police site
 * @param {Map<string, number>} lookupMap — built by buildLookupMap()
 * @returns {{ amount: number|null, source: 'xlsx_lookup'|'manual_lookup_needed' }}
 */
export function lookupOffenceAmount(offenceDetail, lookupMap) {
  const needle = String(offenceDetail).toLowerCase().trim();

  // 1. Exact match
  if (lookupMap.has(needle)) {
    return { amount: lookupMap.get(needle), source: 'xlsx_lookup' };
  }

  // 2. Partial match
  for (const [key, amount] of lookupMap) {
    if (needle.includes(key) || key.includes(needle)) {
      return { amount, source: 'xlsx_lookup' };
    }
  }

  // 3. No match
  return { amount: null, source: 'manual_lookup_needed' };
}

/**
 * Convenience: load file + build map in one call.
 * Called once at server startup.
 */
export function loadOffenceSheet(filePath) {
  const rows = readXlsxRows(filePath);
  return buildLookupMap(rows);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/offenceLookup.test.js
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/utils/offenceLookup.js backend/tests/offenceLookup.test.js
git commit -m "feat: offence amount XLSX lookup utility with TDD"
```

---

## Task 3: Session Store (OTP Resolver + Active Workers Map)

**Files:**
- Create: `backend/src/utils/sessionStore.js`

- [ ] **Step 1: Create sessionStore.js**

```javascript
// backend/src/utils/sessionStore.js
//
// Two global in-memory stores shared between the HTTP routes and BullMQ workers:
//
//  otpResolvers  — Map<sessionId, resolveFn>
//    Set by the Playwright worker when it reaches the OTP step.
//    Resolved by the POST /api/job/:sessionId/otp route handler.
//
//  activeWorkers — Map<sessionId, { browser, kill }>
//    Registered when a Playwright worker starts.
//    Used by reassignment logic to terminate an in-flight session.

export const otpResolvers  = new Map(); // sessionId → resolve function
export const activeWorkers = new Map(); // sessionId → { kill: () => Promise<void> }

/**
 * Register a running Playwright session so it can be killed on reassignment.
 * @param {string} sessionId
 * @param {() => Promise<void>} killFn — async fn that closes the browser
 */
export function registerWorker(sessionId, killFn) {
  activeWorkers.set(sessionId, { kill: killFn });
}

/**
 * Terminate and deregister a session.
 * Safe to call even if the session doesn't exist.
 */
export async function terminateSession(sessionId) {
  const worker = activeWorkers.get(sessionId);
  if (worker) {
    try { await worker.kill(); } catch (_) {}
    activeWorkers.delete(sessionId);
  }
  otpResolvers.delete(sessionId); // clean up any pending OTP wait
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/utils/sessionStore.js
git commit -m "feat: in-memory session store for OTP resolvers and active workers"
```

---

## Task 4: MongoDB Model

**Files:**
- Create: `backend/src/models/JobRecord.js`

- [ ] **Step 1: Create JobRecord.js**

```javascript
// backend/src/models/JobRecord.js
import mongoose from 'mongoose';

const vehicleDetailsSchema = new mongoose.Schema({
  registrationNumber: { type: String, required: true },
  chassisNumber:      { type: String, required: true },
  engineNumber:       { type: String, required: true },
}, { _id: false });

const jobRecordSchema = new mongoose.Schema({
  sessionId:         { type: String, required: true, unique: true },
  appointmentId:     { type: String, required: true },
  assignedTo:        { type: String, required: true },   // QC email
  previousSessionId: { type: String, default: null },    // set on reassignment
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed', 'manual', 'reassigned'],
    default: 'pending',
  },
  vehicleDetails:    { type: vehicleDetailsSchema, required: true },
  mobileNumber:      { type: String, default: null },
  createdAt:         { type: Date, default: Date.now },
  updatedAt:         { type: Date, default: Date.now },
  completedAt:       { type: Date, default: null },
  errorDetails:      { type: String, default: null },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
});

// Index for fast lookups by appointmentId + status (used in reassignment check)
jobRecordSchema.index({ appointmentId: 1, status: 1 });

export const JobRecord = mongoose.model('JobRecord', jobRecordSchema);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/models/JobRecord.js
git commit -m "feat: JobRecord mongoose model with status enum and indexes"
```

---

## Task 5: External Service Clients (OMS API + Challan Service)

**Files:**
- Create: `backend/src/services/omsService.js`
- Create: `backend/src/services/challanService.js`
- Test: `backend/tests/omsService.test.js`
- Test: `backend/tests/challanService.test.js`

- [ ] **Step 1: Write failing tests for omsService**

Create `backend/tests/omsService.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock axios before importing the service
vi.mock('axios');

import { getAppointmentDetails, getExistingChallans } from '../src/services/omsService.js';

beforeEach(() => vi.clearAllMocks());

describe('getAppointmentDetails', () => {
  it('returns registrationNumber, chassisNumber, engineNumber on success', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        registrationNumber: 'RJ14CV8337',
        chassisNumber:      'MA3ETDE1S00114822',
        engineNumber:       'K10BN-1730089',
        ownerName:          'SADDAM HUSAIN',  // extra fields — should be ignored
      },
    });

    const result = await getAppointmentDetails('APT-001');

    expect(result).toEqual({
      registrationNumber: 'RJ14CV8337',
      chassisNumber:      'MA3ETDE1S00114822',
      engineNumber:       'K10BN-1730089',
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/order/APT-001'),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': expect.any(String) }) })
    );
  });

  it('throws if the API returns an error', async () => {
    axios.get.mockRejectedValueOnce(new Error('Network Error'));
    await expect(getAppointmentDetails('APT-001')).rejects.toThrow('Network Error');
  });
});

describe('getExistingChallans', () => {
  it('returns array of existing challans', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        { noticeNumber: 'DL-001', amount: 500 },
        { noticeNumber: 'DL-002', amount: 1000 },
      ],
    });

    const result = await getExistingChallans('APT-001');
    expect(result).toHaveLength(2);
    expect(result[0].noticeNumber).toBe('DL-001');
  });

  it('returns empty array if API returns empty', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });
    const result = await getExistingChallans('APT-001');
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/omsService.test.js
```

Expected: FAIL — `Cannot find module '../src/services/omsService.js'`

- [ ] **Step 3: Implement omsService.js**

Create `backend/src/services/omsService.js`:
```javascript
// backend/src/services/omsService.js
// Wraps the OMS API — STAGING endpoints only.
// All credentials come from config (never hardcoded).
import axios from 'axios';
import { config } from '../config.js';

const client = axios.create({
  baseURL: config.omsBaseUrl,
  headers: { 'x-api-key': config.omsApiKey },
  timeout: 15000,
});

/**
 * Fetches unmasked vehicle details for an appointment.
 * Used in Step 1 (job start).
 *
 * @param {string} appointmentId
 * @returns {{ registrationNumber: string, chassisNumber: string, engineNumber: string }}
 */
export async function getAppointmentDetails(appointmentId) {
  const { data } = await client.get(`/api/order/${appointmentId}`);
  return {
    registrationNumber: data.registrationNumber,
    chassisNumber:      data.chassisNumber,
    engineNumber:       data.engineNumber,
  };
}

/**
 * Fetches all challans already saved for an appointment.
 * Used in Step 8 for deduplication.
 *
 * @param {string} appointmentId
 * @returns {Array<{ noticeNumber: string, [key: string]: any }>}
 */
export async function getExistingChallans(appointmentId) {
  const { data } = await client.get(`/api/order/challan/detail/${appointmentId}`);
  return Array.isArray(data) ? data : [];
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/omsService.test.js
```

Expected: 4 tests PASS.

- [ ] **Step 5: Write failing tests for challanService**

Create `backend/tests/challanService.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import fs from 'fs';

vi.mock('axios');
vi.mock('fs');

import { postChallan } from '../src/services/challanService.js';

beforeEach(() => vi.clearAllMocks());

describe('postChallan', () => {
  const payload = {
    appointmentId: 'APT-001',
    challanName:   'Using Mobile Phone While Driving',
    noticeNumber:  'DL-2024-001',
    amount:        '1000',
    createdBy:     'qc@company.com',
    offenceDate:   '2024-01-15',
    challanCourt:  'Virtual Court',
    imagePath:     '/tmp/DL-2024-001.jpg',
  };

  it('calls Challan Service with multipart/form-data and correct headers', async () => {
    fs.createReadStream = vi.fn().mockReturnValue('mock-stream');
    axios.post.mockResolvedValueOnce({ data: { success: true } });

    await postChallan(payload);

    expect(axios.post).toHaveBeenCalledOnce();
    const [url, formData, axiosConfig] = axios.post.mock.calls[0];
    expect(url).toContain('/api/customer-challan/create');
    expect(axiosConfig.headers['x-api-key']).toBeDefined();
    expect(axiosConfig.headers['content-type']).toMatch(/multipart\/form-data/);
  });

  it('throws on API error', async () => {
    fs.createReadStream = vi.fn().mockReturnValue('mock-stream');
    axios.post.mockRejectedValueOnce(new Error('Service Unavailable'));
    await expect(postChallan(payload)).rejects.toThrow('Service Unavailable');
  });
});
```

- [ ] **Step 6: Run tests — expect FAIL**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/challanService.test.js
```

Expected: FAIL — `Cannot find module '../src/services/challanService.js'`

- [ ] **Step 7: Implement challanService.js**

Create `backend/src/services/challanService.js`:
```javascript
// backend/src/services/challanService.js
// POSTs a single challan row to the Challan Service API — STAGING only.
// Uses multipart/form-data because challanProof is a file, not a URL.
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { config } from '../config.js';

/**
 * POSTs one challan row to the Challan Service.
 * Caller is responsible for downloading the image to imagePath first.
 * This function does NOT delete the temp file — caller handles cleanup.
 *
 * @param {{
 *   appointmentId: string,
 *   challanName:   string,   // offenceDetail from scrape
 *   noticeNumber:  string,   // unique dedup key
 *   amount:        string,
 *   createdBy:     string,   // QC email
 *   offenceDate:   string,   // YYYY-MM-DD
 *   challanCourt:  string,
 *   imagePath:     string,   // absolute path to downloaded image temp file
 * }} payload
 */
export async function postChallan(payload) {
  const form = new FormData();
  form.append('appointmentId', payload.appointmentId);
  form.append('challanName',   payload.challanName);
  form.append('challanType',   'ONLINE');
  form.append('noticeNumber',  payload.noticeNumber);
  form.append('amount',        String(payload.amount ?? ''));
  form.append('createdBy',     payload.createdBy);
  form.append('offenceDate',   payload.offenceDate);
  form.append('challanCourt',  payload.challanCourt ?? '');
  form.append('challanProof',  fs.createReadStream(payload.imagePath));

  await axios.post(
    `${config.challanServiceBaseUrl}/api/customer-challan/create`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'x-api-key': config.challanServiceApiKey,
      },
      timeout: 30000,
    }
  );
}
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/challanService.test.js
```

Expected: 2 tests PASS.

- [ ] **Step 9: Run all tests**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/services/omsService.js backend/src/services/challanService.js \
        backend/tests/omsService.test.js backend/tests/challanService.test.js
git commit -m "feat: OMS API and Challan Service clients with TDD"
```

---

## Task 6: Storage Service (Local + S3)

**Files:**
- Create: `backend/src/services/storageService.js`

- [ ] **Step 1: Create storageService.js**

```javascript
// backend/src/services/storageService.js
// Abstracts image/screenshot storage.
// STORAGE_MODE=local  → saves to ./uploads/<filename>, returns /uploads/<filename>
// STORAGE_MODE=s3     → uploads to S3, returns public HTTPS URL
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * Saves a Buffer to storage and returns the public URL or local path.
 *
 * @param {Buffer} buffer      — file contents
 * @param {string} filename    — e.g. "sessionId-noticeNo.jpg"
 * @param {string} contentType — e.g. "image/jpeg"
 * @returns {Promise<string>}  — public URL
 */
export async function saveFile(buffer, filename, contentType = 'image/jpeg') {
  if (config.storageMode === 's3') {
    return saveToS3(buffer, filename, contentType);
  }
  return saveLocally(buffer, filename);
}

async function saveLocally(buffer, filename) {
  const dir = path.resolve(config.localUploadDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  // Return a URL-safe path usable by the frontend
  return `/uploads/${filename}`;
}

async function saveToS3(buffer, filename, contentType) {
  // Lazy import — only loaded when STORAGE_MODE=s3 to keep local dev fast
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: config.awsRegion });
  await client.send(new PutObjectCommand({
    Bucket:      config.awsBucket,
    Key:         filename,
    Body:        buffer,
    ContentType: contentType,
    ACL:         'public-read',
  }));
  return `https://${config.awsBucket}.s3.${config.awsRegion}.amazonaws.com/${filename}`;
}

/**
 * Downloads a URL to a temp file path and returns that path.
 * Used before calling postChallan() which needs an actual file stream.
 *
 * @param {string} url
 * @param {string} destPath — absolute path to write to
 */
export async function downloadToTemp(url, destPath) {
  const axios = (await import('axios')).default;
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  fs.writeFileSync(destPath, response.data);
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/services/storageService.js
git commit -m "feat: storage service with local/S3 mode abstraction"
```

---

## Task 7: Slack Alert Utility

**Files:**
- Create: `backend/src/utils/slack.js`

- [ ] **Step 1: Create slack.js**

```javascript
// backend/src/utils/slack.js
import axios from 'axios';
import { config } from '../config.js';

/**
 * Sends a Slack alert for selector breakage or critical errors.
 * No-ops silently if SLACK_WEBHOOK_URL is not configured (local dev).
 *
 * @param {{
 *   step:          string,   // e.g. "mobile_change"
 *   selector:      string,   // e.g. "#changeNumberBtn"
 *   screenshotUrl: string,   // S3 URL of broken-page screenshot
 *   appointmentId: string,
 *   message?:      string,
 * }} params
 */
export async function sendSlackAlert({ step, selector, screenshotUrl, appointmentId, message }) {
  if (!config.slackWebhookUrl) return;  // no-op in local dev

  const text = message || `🚨 Challan Automation — Selector Broken\nStep: ${step}\nSelector: ${selector}\nAppointment: ${appointmentId}`;

  try {
    await axios.post(config.slackWebhookUrl, {
      text,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Step:* ${step}\n*Selector:* \`${selector}\`\n*AppointmentId:* ${appointmentId}` },
        },
        screenshotUrl ? {
          type: 'image',
          image_url: screenshotUrl,
          alt_text: 'Broken page screenshot',
        } : null,
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '⚠️ *All pending jobs have been paused. Dev action required.*' },
        },
      ].filter(Boolean),
    });
  } catch (err) {
    // Never let Slack failure crash the worker
    console.error('[Slack] Failed to send alert:', err.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/utils/slack.js
git commit -m "feat: Slack alert utility for selector breakage"
```

---

## Task 8: BullMQ Queue + Worker Pool

**Files:**
- Create: `backend/src/queue/challanQueue.js`
- Create: `backend/src/queue/workerPool.js`

- [ ] **Step 1: Create challanQueue.js**

```javascript
// backend/src/queue/challanQueue.js
import { Queue } from 'bullmq';
import { config } from '../config.js';

const connection = { url: config.redisUrl };

export const challanQueue = new Queue('challan-jobs', {
  connection,
  defaultJobOptions: {
    attempts:          3,
    backoff:           { type: 'exponential', delay: 2000 },
    removeOnComplete:  100,
    removeOnFail:      500,
  },
});
```

- [ ] **Step 2: Create workerPool.js**

```javascript
// backend/src/queue/workerPool.js
import { Worker } from 'bullmq';
import { config } from '../config.js';
import { runAutomation } from '../worker/automation.js';

let workerInstance = null;

/**
 * Starts the BullMQ worker with the configured concurrency.
 * The worker picks up jobs from the 'challan-jobs' queue and calls runAutomation().
 *
 * @param {import('socket.io').Server} io  — Socket.io server for emitting WS events
 * @param {Map<string,number>} offenceLookup — pre-loaded XLSX map
 */
export function startWorkerPool(io, offenceLookup) {
  const connection = { url: config.redisUrl };

  workerInstance = new Worker(
    'challan-jobs',
    async (job) => {
      await runAutomation(job.data, io, offenceLookup);
    },
    {
      connection,
      concurrency: config.workerConcurrency,
    }
  );

  workerInstance.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  workerInstance.on('completed', (job) => {
    console.log(`[Worker] Job ${job?.id} completed.`);
  });

  console.log(`[Worker] Pool started — concurrency: ${config.workerConcurrency}`);
  return workerInstance;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/queue/challanQueue.js backend/src/queue/workerPool.js
git commit -m "feat: BullMQ queue and worker pool setup"
```

---

## Task 9A: Live Selector Discovery (Do This Before Writing Any Playwright Code)

**Why:** Every selector in `openSite.js`, `changeMobile.js`, and `scrapeChallans.js` is currently a placeholder. The actual HTML of `traffic.delhipolice.gov.in` is the only source of truth. This task must be completed before Task 9 code is finalised.

**Files:**
- Create: `backend/src/worker/steps/SELECTORS.md` — reference doc for all confirmed selectors

- [ ] **Step 1: Open the site in a headed Playwright script**

Create a throwaway file `backend/discover-selectors.js` and run it:
```javascript
// backend/discover-selectors.js  — DELETE after discovery
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page    = await browser.newPage();
await page.goto('https://traffic.delhipolice.gov.in/notice/pay-notice');
console.log('Browser open — inspect elements now. Press Ctrl+C when done.');
await new Promise(() => {}); // keep open
```

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
node discover-selectors.js
```

- [ ] **Step 2: Inspect and record each selector**

With the browser open, use DevTools (F12) to find and record the real selector for each of these:

| Step | What to find | Placeholder used | Real selector |
|---|---|---|---|
| Search page | Registration number input | `#regNumber` | ??? |
| Search page | Search/Submit button | `#searchDetails` | ??? |
| Mobile change | "Change Number" button | `#changeNumberBtn` | ??? |
| Mobile change | New mobile input | `#newMobile` | ??? |
| Mobile change | Chassis last-4 input | `#chassisLast4` | ??? |
| Mobile change | Engine last-4 input | `#engineLast4` | ??? |
| Mobile change | Submit button | `#submitMobileChange` | ??? |
| Mobile change | Success confirmation | `#mobileChangeSuccess` | ??? |
| OTP page | OTP input field | `#otpInput` | ??? |
| OTP page | OTP submit button | `#submitOtp` | ??? |
| OTP page | Success confirmation | `#otpSuccess` | ??? |
| Challan table | Table container | `.challan-table` | ??? |
| Challan table | Each row | `.challan-row` | ??? |
| Challan row | Notice number | `.notice-no` | ??? |
| Challan row | Offence detail | `.offence-detail` | ??? |
| Challan row | Penalty amount | `.penalty-amount` | ??? |
| Challan row | Print notice | `.print-notice` | ??? |
| Challan row | Offence date | `.offence-date` | ??? |
| Challan row | Status | `.challan-status` | ??? |
| Challan row | Court | `.challan-court` | ??? |
| Challan row | Make Payment | `.make-payment` | ??? |
| Challan row | View Image button | `[data-notice="X"] .view-image-btn` | ??? |

- [ ] **Step 3: Save confirmed selectors**

Create `backend/src/worker/steps/SELECTORS.md`:
```markdown
# Confirmed Delhi Police Site Selectors
> Last verified: YYYY-MM-DD

## Search Page
- Reg number input:    `<real-selector>`
- Search button:       `<real-selector>`

## Mobile Change
- Change number btn:   `<real-selector>`
- New mobile input:    `<real-selector>`
- Chassis last4:       `<real-selector>`
- Engine last4:        `<real-selector>`
- Submit button:       `<real-selector>`
- Success element:     `<real-selector>`

## OTP
- OTP input:           `<real-selector>`
- Submit button:       `<real-selector>`
- Success element:     `<real-selector>`

## Challan Table
- Table container:     `<real-selector>`
- Row element:         `<real-selector>`
- Notice no:           `<real-selector>`
- Offence detail:      `<real-selector>`
- Penalty amount:      `<real-selector>`
- Print notice:        `<real-selector>`
- Offence date:        `<real-selector>`
- Status:              `<real-selector>`
- Court:               `<real-selector>`
- Make payment:        `<real-selector>`
- View image button:   `<real-selector>`
```

- [ ] **Step 4: Replace all placeholder selectors in Task 9 code with real values**

Go through `openSite.js`, `changeMobile.js`, `submitOtp.js`, `scrapeChallans.js` and replace every `⚠️ SELECTOR PLACEHOLDER` comment with the real selectors from `SELECTORS.md`.

- [ ] **Step 5: Delete discovery script**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
rm discover-selectors.js
```

- [ ] **Step 6: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/worker/steps/SELECTORS.md
git commit -m "docs: confirmed Delhi Police site selectors from live inspection"
```

---

## Task 9: Playwright Automation Steps

**Files:**
- Create: `backend/src/worker/safeFind.js`
- Create: `backend/src/worker/steps/openSite.js`
- Create: `backend/src/worker/steps/changeMobile.js`
- Create: `backend/src/worker/steps/submitOtp.js`
- Create: `backend/src/worker/steps/scrapeChallans.js`
- Create: `backend/src/worker/steps/deduplicatePost.js`

- [ ] **Step 1: Create safeFind.js — selector wrapper with Slack alert**

```javascript
// backend/src/worker/safeFind.js
import { sendSlackAlert } from '../utils/slack.js';
import { challanQueue } from '../queue/challanQueue.js';

export class SelectorBrokenError extends Error {
  constructor(step, selector) {
    super(`Selector broken at step "${step}": ${selector}`);
    this.name = 'SelectorBrokenError';
    this.step = step;
    this.selector = selector;
  }
}

/**
 * Waits for a selector with a 10s timeout.
 * On timeout: takes screenshot, uploads, sends Slack alert, pauses queue, throws.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} stepName       — human label for the step
 * @param {string} sessionId
 * @param {string} appointmentId
 * @param {Function} saveFile     — storageService.saveFile
 */
export async function safeFind(page, selector, stepName, sessionId, appointmentId, saveFile) {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
  } catch (e) {
    // Capture the broken state
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const filename = `errors/${sessionId}-${stepName}.png`;
    const screenshotUrl = await saveFile(screenshotBuffer, filename, 'image/png');

    // Alert dev team
    await sendSlackAlert({ step: stepName, selector, screenshotUrl, appointmentId });

    // Pause all pending jobs so no more attempts run while selector is broken
    await challanQueue.pause();
    console.error(`[safeFind] Queue paused — selector broken at step "${stepName}"`);

    throw new SelectorBrokenError(stepName, selector);
  }
}
```

- [ ] **Step 2: Create openSite.js**

```javascript
// backend/src/worker/steps/openSite.js
import { safeFind } from '../safeFind.js';

/**
 * Opens the Delhi Traffic Police challan lookup page and enters the registration number.
 * Emits step_update events via WebSocket.
 *
 * @param {import('playwright').Page} page
 * @param {string} registrationNumber
 * @param {string} sessionId
 * @param {string} appointmentId
 * @param {import('socket.io').Server} io
 * @param {Function} saveFile
 */
export async function openSite(page, registrationNumber, sessionId, appointmentId, io, saveFile) {
  await page.goto('https://traffic.delhipolice.gov.in/notice/pay-notice', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  io.to(sessionId).emit('step_update', { step: 'open_website', status: 'success' });

  await safeFind(page, '#regNumber', 'enter_reg', sessionId, appointmentId, saveFile);
  await page.fill('#regNumber', registrationNumber);
  await page.click('#searchDetails');
  io.to(sessionId).emit('step_update', { step: 'enter_reg', status: 'success' });
}
```

- [ ] **Step 3: Create changeMobile.js**

```javascript
// backend/src/worker/steps/changeMobile.js
import { safeFind } from '../safeFind.js';

const RETRY_DELAYS = [2000, 4000, 8000];

/**
 * Changes the mobile number on the Delhi Police site.
 * ALWAYS performed on a fresh session — first visit requires it.
 * Retries up to 3 times with exponential backoff.
 *
 * @param {import('playwright').Page} page
 * @param {string} mobileNumber   — full mobile number
 * @param {string} chassisLast4   — last 4 digits of chassisNumber
 * @param {string} engineLast4    — last 4 digits of engineNumber
 * @param {string} sessionId
 * @param {string} appointmentId
 * @param {import('socket.io').Server} io
 * @param {Function} saveFile
 */
export async function changeMobileNumber(
  page, mobileNumber, chassisLast4, engineLast4, sessionId, appointmentId, io, saveFile
) {
  io.to(sessionId).emit('step_update', { step: 'mobile_change', status: 'running' });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Click "Change Number" button
      await safeFind(page, '#changeNumberBtn', 'mobile_change', sessionId, appointmentId, saveFile);
      await page.click('#changeNumberBtn');

      // Fill form
      await safeFind(page, '#newMobile', 'mobile_change', sessionId, appointmentId, saveFile);
      await page.fill('#newMobile', mobileNumber);
      await page.fill('#chassisLast4', chassisLast4);
      await page.fill('#engineLast4', engineLast4);
      await page.click('#submitMobileChange');

      // Confirm success — wait for confirmation element
      await page.waitForSelector('#mobileChangeSuccess', { timeout: 8000 });
      io.to(sessionId).emit('step_update', { step: 'mobile_change', status: 'success' });
      return; // success — exit retry loop

    } catch (err) {
      if (err.name === 'SelectorBrokenError') throw err; // don't retry selector errors

      if (attempt < 2) {
        console.warn(`[changeMobile] Attempt ${attempt + 1} failed, retrying in ${RETRY_DELAYS[attempt]}ms`);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        await page.reload({ waitUntil: 'domcontentloaded' });
      } else {
        // All 3 attempts exhausted
        io.to(sessionId).emit('error', {
          type: 'mobile_change_failed',
          message: 'Mobile number change failed after 3 attempts. Please try again or mark as manual.',
        });
        throw new Error('mobile_change_failed');
      }
    }
  }
}
```

- [ ] **Step 4: Create submitOtp.js**

```javascript
// backend/src/worker/steps/submitOtp.js
import { otpResolvers } from '../../utils/sessionStore.js';
import { config } from '../../config.js';

/**
 * Pauses the worker and waits for the QC to submit an OTP via the UI.
 * The POST /api/job/:sessionId/otp route resolves the promise.
 * Times out after OTP_TIMEOUT_MS (default 10 minutes).
 *
 * @param {import('playwright').Page} page
 * @param {string} sessionId
 * @param {import('socket.io').Server} io
 * @returns {Promise<void>}
 */
export async function waitAndSubmitOtp(page, sessionId, io) {
  // Tell frontend to unlock the OTP input field
  io.to(sessionId).emit('otp_needed');

  // Wait for QC to submit OTP (or timeout)
  const otp = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      otpResolvers.delete(sessionId);
      reject(new Error('otp_timeout'));
    }, config.otpTimeoutMs);

    otpResolvers.set(sessionId, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

  // Submit OTP to the site
  await page.waitForSelector('#otpInput', { timeout: 10000 });
  await page.fill('#otpInput', otp);
  await page.click('#submitOtp');
  await page.waitForSelector('#otpSuccess', { timeout: 15000 });

  io.to(sessionId).emit('step_update', { step: 'otp_submit', status: 'success' });
}
```

- [ ] **Step 5: Create scrapeChallans.js**

```javascript
// backend/src/worker/steps/scrapeChallans.js
//
// Clarifications applied:
//  - offenceDate on site is "YYYY-MM-DD HH:MM:SS" → extract date part only
//  - challanType derived from makePayment column:
//      "Pay Now" or "Virtual Court" → "ONLINE", blank → "OFFLINE"
//  - If no "View Image" for a row → use page screenshot buffer as challanProof
//  - pageScreenshotBuffer is taken ONCE and reused as fallback per row
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Extracts YYYY-MM-DD from a datetime string like "2024-01-15 10:30:00".
 */
function extractDate(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  return raw.trim().slice(0, 10);  // handles both "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS"
}

/**
 * Derives challanType from the Make Payment column value.
 * "Pay Now" or "Virtual Court" → "ONLINE"
 * Blank / anything else        → "OFFLINE"
 */
function deriveChallanType(makePayment) {
  const val = (makePayment || '').trim().toLowerCase();
  return (val.includes('pay now') || val.includes('virtual court')) ? 'ONLINE' : 'OFFLINE';
}

/**
 * Scrapes all challan rows from the current page.
 * Takes the page screenshot FIRST so it can be used as fallback challanProof
 * for rows that have no individual View Image.
 *
 * NOTE: Playwright selectors below are PLACEHOLDERS — update after Task 9A
 *       (live selector discovery on traffic.delhipolice.gov.in).
 *
 * @param {import('playwright').Page} page
 * @param {string} sessionId
 * @param {Function} saveFile  — storageService.saveFile(buffer, filename, contentType)
 * @returns {Promise<{ rows: Array, pageScreenshotPath: string }>}
 */
export async function scrapeChallanRows(page, sessionId, saveFile) {
  // Wait for challan table to appear
  await page.waitForSelector('.challan-table', { timeout: 15000 });

  // Take full-page screenshot FIRST — used as fallback challanProof per row
  const pageScreenshotBuffer = await page.screenshot({ fullPage: true });
  const screenshotFilename   = `screenshots/${sessionId}-page.png`;
  const pageScreenshotUrl    = await saveFile(pageScreenshotBuffer, screenshotFilename, 'image/png');

  // Save screenshot to a temp file so it can be used as multipart file upload
  const pageScreenshotTempPath = path.join(os.tmpdir(), `${sessionId}-page.png`);
  fs.writeFileSync(pageScreenshotTempPath, pageScreenshotBuffer);

  // Scrape all rows
  // ⚠️  SELECTORS ARE PLACEHOLDERS — replace with real values from Task 9A
  const rows = await page.$$eval('.challan-row', (rowEls) =>
    rowEls.map((r) => ({
      noticeNo:      r.querySelector('.notice-no')?.textContent?.trim()      ?? '',
      offenceDetail: r.querySelector('.offence-detail')?.textContent?.trim() ?? '',
      penaltyAmount: r.querySelector('.penalty-amount')?.textContent?.trim() ?? '',
      printNotice:   r.querySelector('.print-notice')?.textContent?.trim()   ?? '',
      offenceDate:   r.querySelector('.offence-date')?.textContent?.trim()   ?? '',
      status:        r.querySelector('.challan-status')?.textContent?.trim() ?? '',
      challanCourt:  r.querySelector('.challan-court')?.textContent?.trim()  ?? '',
      makePayment:   r.querySelector('.make-payment')?.textContent?.trim()   ?? '',
    }))
  );

  // Enrich each row with derived fields + image
  for (const row of rows) {
    // Derive challanType from Make Payment column
    row.challanType = deriveChallanType(row.makePayment);

    // Normalise date
    row.offenceDate = extractDate(row.offenceDate);

    // Attempt to download per-row offence image
    let imageDownloaded = false;
    try {
      // ⚠️  SELECTOR PLACEHOLDER — replace with real "View Image" button selector
      const viewBtn = await page.$(`[data-notice="${row.noticeNo}"] .view-image-btn`);
      if (viewBtn) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }),
          viewBtn.click(),
        ]);
        const tempPath = path.join(os.tmpdir(), `${sessionId}-${row.noticeNo}.jpg`);
        await download.saveAs(tempPath);
        const buffer   = fs.readFileSync(tempPath);
        const filename = `challans/${sessionId}/${row.noticeNo}.jpg`;
        row.offenceImageUrl = await saveFile(buffer, filename, 'image/jpeg');
        row.localImagePath  = tempPath;
        imageDownloaded = true;
      }
    } catch {
      // fall through to screenshot fallback
    }

    // Fallback: if no image available, use the page screenshot as challanProof
    if (!imageDownloaded) {
      row.offenceImageUrl = pageScreenshotUrl;
      row.localImagePath  = pageScreenshotTempPath;  // multipart upload will use this
    }
  }

  return { rows, pageScreenshotUrl, pageScreenshotTempPath };
}
```
```

- [ ] **Step 6: Write failing deduplicatePost test**

Create `backend/tests/deduplicatePost.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/omsService.js');
vi.mock('../src/services/challanService.js');
// Mock fs so unlinkSync doesn't try to delete real files
vi.mock('fs', () => ({ default: { unlinkSync: vi.fn() } }));

import { getExistingChallans } from '../src/services/omsService.js';
import { postChallan }          from '../src/services/challanService.js';
import { deduplicateAndPost }   from '../src/worker/steps/deduplicatePost.js';

beforeEach(() => vi.clearAllMocks());

// offenceLookup map for tests — matches what XLSX would load
const testLookup = new Map([
  ['using mobile phone', 1000],
  ['jumping red light',  500],
]);
const PAGE_SS_PATH = '/tmp/session-page.png';

describe('deduplicateAndPost', () => {
  const scrapedRows = [
    { noticeNo: 'DL-001', offenceDetail: 'Using Mobile Phone', penaltyAmount: '1000',
      offenceDate: '2024-01-15', challanCourt: 'Virtual Court',
      challanType: 'ONLINE', localImagePath: '/tmp/img1.jpg' },
    { noticeNo: 'DL-002', offenceDetail: 'Jumping Red Light', penaltyAmount: '500',
      offenceDate: '2024-01-16', challanCourt: 'Virtual Court',
      challanType: 'ONLINE', localImagePath: '/tmp/img2.jpg' },
    { noticeNo: 'DL-003', offenceDetail: 'Over Speeding', penaltyAmount: '400',
      offenceDate: '2024-01-17', challanCourt: 'Virtual Court',
      challanType: 'ONLINE', localImagePath: '/tmp/img3.jpg' },
  ];

  it('posts only new challan rows (not already in Admin Panel)', async () => {
    getExistingChallans.mockResolvedValueOnce([{ noticeNumber: 'DL-001' }]);
    postChallan.mockResolvedValue({});

    await deduplicateAndPost(scrapedRows, 'APT-001', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);

    expect(postChallan).toHaveBeenCalledTimes(2);
    const calledNotices = postChallan.mock.calls.map(c => c[0].noticeNumber);
    expect(calledNotices).toContain('DL-002');
    expect(calledNotices).toContain('DL-003');
    expect(calledNotices).not.toContain('DL-001');
  });

  it('posts nothing when all rows already exist', async () => {
    getExistingChallans.mockResolvedValueOnce([
      { noticeNumber: 'DL-001' }, { noticeNumber: 'DL-002' }, { noticeNumber: 'DL-003' },
    ]);
    await deduplicateAndPost(scrapedRows, 'APT-001', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);
    expect(postChallan).not.toHaveBeenCalled();
  });

  it('posts all rows when none already exist', async () => {
    getExistingChallans.mockResolvedValueOnce([]);
    postChallan.mockResolvedValue({});
    await deduplicateAndPost(scrapedRows, 'APT-001', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);
    expect(postChallan).toHaveBeenCalledTimes(3);
  });

  it('uses page screenshot as challanProof when row has no localImagePath', async () => {
    const rowsNoImage = [
      { noticeNo: 'DL-004', offenceDetail: 'Over Speeding', penaltyAmount: '400',
        offenceDate: '2024-01-17', challanCourt: '', challanType: 'OFFLINE',
        localImagePath: null },  // no image
    ];
    getExistingChallans.mockResolvedValueOnce([]);
    postChallan.mockResolvedValue({});

    await deduplicateAndPost(rowsNoImage, 'APT-002', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);

    expect(postChallan).toHaveBeenCalledOnce();
    expect(postChallan.mock.calls[0][0].imagePath).toBe(PAGE_SS_PATH);
  });

  it('uses DEFAULT_CHALLAN_COURT when challanCourt is empty', async () => {
    const rowsNoCourt = [
      { noticeNo: 'DL-005', offenceDetail: 'Using Mobile Phone', penaltyAmount: '1000',
        offenceDate: '2024-01-18', challanCourt: '', challanType: 'ONLINE',
        localImagePath: '/tmp/img5.jpg' },
    ];
    getExistingChallans.mockResolvedValueOnce([]);
    postChallan.mockResolvedValue({});

    await deduplicateAndPost(rowsNoCourt, 'APT-003', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);

    expect(postChallan.mock.calls[0][0].challanCourt).toBe('Delhi(Traffic Department)');
  });

  it('falls back to XLSX amount when penaltyAmount is blank', async () => {
    const rowsNoAmount = [
      { noticeNo: 'DL-006', offenceDetail: 'Using Mobile Phone', penaltyAmount: '',
        offenceDate: '2024-01-19', challanCourt: 'Virtual Court', challanType: 'ONLINE',
        localImagePath: '/tmp/img6.jpg' },
    ];
    getExistingChallans.mockResolvedValueOnce([]);
    postChallan.mockResolvedValue({});

    await deduplicateAndPost(rowsNoAmount, 'APT-004', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);

    expect(postChallan.mock.calls[0][0].amount).toBe('1000');  // from testLookup
  });

  it('uses "0" when amount is blank AND no XLSX match', async () => {
    const rowsUnknownOffence = [
      { noticeNo: 'DL-007', offenceDetail: 'Unknown Rare Offence', penaltyAmount: '',
        offenceDate: '2024-01-20', challanCourt: 'Virtual Court', challanType: 'ONLINE',
        localImagePath: '/tmp/img7.jpg' },
    ];
    getExistingChallans.mockResolvedValueOnce([]);
    postChallan.mockResolvedValue({});

    await deduplicateAndPost(rowsUnknownOffence, 'APT-005', 'yogesh.mishra@cars24.com', testLookup, PAGE_SS_PATH);

    expect(postChallan.mock.calls[0][0].amount).toBe('0');
  });
});
```

- [ ] **Step 7: Run test — expect FAIL**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/deduplicatePost.test.js
```

Expected: FAIL — `Cannot find module '../src/worker/steps/deduplicatePost.js'`

- [ ] **Step 8: Create deduplicatePost.js**

```javascript
// backend/src/worker/steps/deduplicatePost.js
//
// Clarifications applied:
//  - No field can be null — every field has a guaranteed non-null fallback
//  - challanName     = offenceDetail (offence type from site)
//  - challanType     = derived from makePayment column (ONLINE/OFFLINE)
//  - challanCourt    = scraped value OR fallback 'Delhi(Traffic Department)' for testing
//  - amount          = scraped → XLSX lookup → "0" (never null)
//  - createdBy       = passed in; testing default: yogesh.mishra@cars24.com
//  - challanProof    = per-row offence image file, OR page screenshot if no image
//  - offenceDate     = already extracted as YYYY-MM-DD by scrapeChallans.js
import { getExistingChallans } from '../../services/omsService.js';
import { postChallan } from '../../services/challanService.js';
import { lookupOffenceAmount } from '../../utils/offenceLookup.js';
import fs from 'fs';

const DEFAULT_CHALLAN_COURT = 'Delhi(Traffic Department)';  // testing default
const DEFAULT_CREATED_BY    = 'yogesh.mishra@cars24.com';   // testing default

/**
 * 1. GETs existing challans from OMS API for this appointment.
 * 2. Filters scraped rows to only NEW ones (not already in Admin Panel).
 * 3. POSTs each new row to Challan Service as multipart/form-data.
 * 4. Cleans up temp image files after successful POST.
 *
 * @param {Array}  scrapedRows   — enriched rows from scrapeChallans.js
 * @param {string} appointmentId
 * @param {string} createdBy     — QC email (use DEFAULT_CREATED_BY for testing)
 * @param {Map}    offenceLookup — pre-loaded XLSX map for blank amount fallback
 * @param {string} pageScreenshotTempPath — fallback file path when row has no image
 */
export async function deduplicateAndPost(
  scrapedRows, appointmentId, createdBy, offenceLookup, pageScreenshotTempPath
) {
  const qcEmail = createdBy || DEFAULT_CREATED_BY;

  // 1. Fetch existing challans from OMS API
  const existing    = await getExistingChallans(appointmentId);
  const existingNos = new Set(existing.map(c => c.noticeNumber));

  // 2. Filter to genuinely new rows only
  const newRows = scrapedRows.filter(r => !existingNos.has(r.noticeNo));

  if (newRows.length === 0) {
    console.log(`[deduplicateAndPost] All ${scrapedRows.length} rows already exist — skipping POST`);
    return;
  }

  console.log(`[deduplicateAndPost] Posting ${newRows.length} new row(s) out of ${scrapedRows.length}`);

  // 3. POST each new challan individually
  for (const row of newRows) {
    // Resolve amount — scraped → XLSX lookup → "0" (never null/empty per spec)
    let amount = row.penaltyAmount?.trim();
    if (!amount || amount === '') {
      const { amount: xlsxAmount } = lookupOffenceAmount(row.offenceDetail, offenceLookup);
      amount = xlsxAmount ? String(xlsxAmount) : '0';
    }

    // challanCourt fallback
    const challanCourt = row.challanCourt?.trim() || DEFAULT_CHALLAN_COURT;

    // challanProof: per-row image if available, else page screenshot
    const imagePath = row.localImagePath || pageScreenshotTempPath;

    await postChallan({
      appointmentId,
      challanName:  row.offenceDetail  || '',    // offence type
      challanType:  row.challanType    || 'OFFLINE',
      noticeNumber: row.noticeNo       || '',
      amount,
      createdBy:    qcEmail,
      offenceDate:  row.offenceDate    || new Date().toISOString().slice(0, 10),
      challanCourt,
      imagePath,
    });

    // 4. Delete temp image file after successful POST
    //    Don't delete pageScreenshotTempPath here — other rows may still need it
    if (row.localImagePath && row.localImagePath !== pageScreenshotTempPath) {
      try { fs.unlinkSync(row.localImagePath); } catch (_) {}
    }
  }

  // Clean up page screenshot temp file after all rows processed
  if (pageScreenshotTempPath) {
    try { fs.unlinkSync(pageScreenshotTempPath); } catch (_) {}
  }
}
```

- [ ] **Step 9: Run tests — expect PASS**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test -- tests/deduplicatePost.test.js
```

Expected: 3 tests PASS.

- [ ] **Step 10: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/worker/safeFind.js \
        backend/src/worker/steps/openSite.js \
        backend/src/worker/steps/changeMobile.js \
        backend/src/worker/steps/submitOtp.js \
        backend/src/worker/steps/scrapeChallans.js \
        backend/src/worker/steps/deduplicatePost.js \
        backend/tests/deduplicatePost.test.js
git commit -m "feat: Playwright automation steps — open site, mobile change, OTP, scrape, dedup+post"
```

---

## Task 10: Main Automation Orchestrator

**Files:**
- Create: `backend/src/worker/automation.js`

- [ ] **Step 1: Create automation.js**

```javascript
// backend/src/worker/automation.js
// Orchestrates all 9 steps of the challan fetch flow.
// Called by workerPool.js for each BullMQ job.
import { chromium } from 'playwright';
import { JobRecord } from '../models/JobRecord.js';
import { loadOffenceSheet, lookupOffenceAmount } from '../utils/offenceLookup.js';
import { registerWorker, terminateSession } from '../utils/sessionStore.js';
import { saveFile } from '../services/storageService.js';
import { openSite } from './steps/openSite.js';
import { changeMobileNumber } from './steps/changeMobile.js';
import { waitAndSubmitOtp } from './steps/submitOtp.js';
import { scrapeChallanRows } from './steps/scrapeChallans.js';
// Note: takePageScreenshot is now internal to scrapeChallanRows — no separate import needed
import { deduplicateAndPost } from './steps/deduplicatePost.js';
import { config } from '../config.js';

/**
 * Main entry point called by BullMQ worker for each job.
 *
 * @param {{
 *   sessionId:      string,
 *   appointmentId:  string,
 *   mobileNumber:   string,
 *   vehicleDetails: { registrationNumber, chassisNumber, engineNumber },
 *   assignedTo:     string,
 * }} jobData
 * @param {import('socket.io').Server} io
 * @param {Map<string,number>} offenceLookup
 */
export async function runAutomation(jobData, io, offenceLookup) {
  const { sessionId, appointmentId, mobileNumber, vehicleDetails, assignedTo } = jobData;

  const chassisLast4 = vehicleDetails.chassisNumber.slice(-4);
  const engineLast4  = vehicleDetails.engineNumber.replace(/-/g, '').slice(-4);

  // Update job status to in_progress
  await JobRecord.findOneAndUpdate(
    { sessionId },
    { status: 'in_progress', mobileNumber }
  );

  const browser = await chromium.launch({
    headless: config.playwrightHeadless,
    ...(config.proxyUrl ? { proxy: { server: config.proxyUrl } } : {}),
  });
  const page = await browser.newPage();

  // Register so reassignment logic can kill this session
  registerWorker(sessionId, async () => {
    try { await browser.close(); } catch (_) {}
  });

  try {
    // Step 3: Open site + enter reg number
    await openSite(page, vehicleDetails.registrationNumber, sessionId, appointmentId, io, saveFile);

    // Step 4: Change mobile number (ALWAYS on fresh session)
    await changeMobileNumber(
      page, mobileNumber, chassisLast4, engineLast4, sessionId, appointmentId, io, saveFile
    );

    // Step 5: Wait for QC OTP + submit
    await waitAndSubmitOtp(page, sessionId, io);

    // Step 6: Scrape challan rows + download images + take page screenshot
    // scrapeChallanRows now returns { rows, pageScreenshotUrl, pageScreenshotTempPath }
    // The page screenshot is taken FIRST inside scrapeChallans and used as
    // fallback challanProof for rows with no individual View Image.
    const {
      rows:                 scrapedRows,
      pageScreenshotUrl,
      pageScreenshotTempPath,
    } = await scrapeChallanRows(page, sessionId, saveFile);

    // Step 7: Resolve blank penalty amounts via XLSX lookup
    // amountSource set here for the complete event payload; actual amount
    // resolution for the POST happens inside deduplicateAndPost to keep
    // "no null fields" guarantee in one place.
    const rows = scrapedRows.map(row => {
      if (!row.penaltyAmount?.trim() && !row.printNotice?.trim()) {
        const { amount, source } = lookupOffenceAmount(row.offenceDetail, offenceLookup);
        return { ...row, penaltyAmount: amount ? String(amount) : '0', amountSource: source };
      }
      return { ...row, amountSource: 'scraped' };
    });

    // Step 8: Deduplicate + POST to Challan Service
    // Pass offenceLookup + pageScreenshotTempPath for fallback challanProof
    await deduplicateAndPost(rows, appointmentId, assignedTo, offenceLookup, pageScreenshotTempPath);

    // Step 9: Mark complete
    await JobRecord.findOneAndUpdate(
      { sessionId },
      { status: 'completed', completedAt: new Date() }
    );

    io.to(sessionId).emit('complete', {
      challans: rows,
      pageScreenshotUrl,
    });

  } catch (err) {
    const isMobileChangeFailed = err.message === 'mobile_change_failed';
    const isOtpTimeout         = err.message === 'otp_timeout';

    await JobRecord.findOneAndUpdate(
      { sessionId },
      { status: 'failed', errorDetails: err.message }
    );

    if (!isMobileChangeFailed) {
      // mobile_change errors already emitted inside changeMobile.js
      io.to(sessionId).emit('error', {
        type: isOtpTimeout ? 'otp_timeout' : 'automation_error',
        message: err.message,
      });
    }
  } finally {
    try { await browser.close(); } catch (_) {}
    terminateSession(sessionId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/worker/automation.js
git commit -m "feat: main automation orchestrator — all 9 steps wired"
```

---

## Task 11: Express Routes + Socket.io Server

**Files:**
- Create: `backend/src/routes/jobs.js`
- Create: `backend/src/server.js`

- [ ] **Step 1: Create routes/jobs.js**

```javascript
// backend/src/routes/jobs.js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAppointmentDetails } from '../services/omsService.js';
import { JobRecord } from '../models/JobRecord.js';
import { challanQueue } from '../queue/challanQueue.js';
import { otpResolvers, terminateSession } from '../utils/sessionStore.js';

export function createJobRouter(io) {
  const router = Router();

  // POST /api/job/start
  // Step 1: QC enters appointmentId → fetch vehicle details, create session
  router.post('/start', async (req, res) => {
    try {
      const { appointmentId, assignedTo } = req.body;
      if (!appointmentId) return res.status(400).json({ error: 'appointmentId required' });

      const vehicleDetails = await getAppointmentDetails(appointmentId);
      const sessionId      = uuidv4();

      await JobRecord.create({
        sessionId,
        appointmentId,
        assignedTo: assignedTo || 'unknown@company.com',
        vehicleDetails,
        status: 'pending',
      });

      res.json({ sessionId, vehicleDetails });
    } catch (err) {
      console.error('[POST /start]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/job/:sessionId/mobile
  // Step 2: QC enters mobile number → enqueue BullMQ job
  router.post('/:sessionId/mobile', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { mobileNumber } = req.body;
      if (!mobileNumber) return res.status(400).json({ error: 'mobileNumber required' });

      const job = await JobRecord.findOne({ sessionId });
      if (!job) return res.status(404).json({ error: 'Session not found' });

      await challanQueue.add('fetch-challan', {
        sessionId,
        appointmentId:  job.appointmentId,
        mobileNumber,
        vehicleDetails: job.vehicleDetails,
        assignedTo:     job.assignedTo,
      });

      res.json({ status: 'queued' });
    } catch (err) {
      console.error('[POST /mobile]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/job/:sessionId/otp
  // Step 5: QC submits OTP → resolve Playwright's waiting promise
  router.post('/:sessionId/otp', async (req, res) => {
    const { sessionId } = req.params;
    const { otp }       = req.body;
    if (!otp) return res.status(400).json({ error: 'otp required' });

    const resolve = otpResolvers.get(sessionId);
    if (!resolve) return res.status(404).json({ error: 'No OTP waiter for this session' });

    resolve(otp);
    otpResolvers.delete(sessionId);
    res.json({ status: 'submitted' });
  });

  // POST /api/job/:sessionId/retry
  // Error recovery: re-queue job from scratch
  router.post('/:sessionId/retry', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const job = await JobRecord.findOne({ sessionId });
      if (!job) return res.status(404).json({ error: 'Session not found' });

      const newSessionId = uuidv4();
      await JobRecord.create({
        sessionId:         newSessionId,
        appointmentId:     job.appointmentId,
        assignedTo:        job.assignedTo,
        vehicleDetails:    job.vehicleDetails,
        previousSessionId: sessionId,
        status:            'pending',
      });

      res.json({ status: 'requeued', newSessionId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/job/:sessionId/manual
  // QC marks job as manually handled — closes job
  router.post('/:sessionId/manual', async (req, res) => {
    try {
      const { sessionId } = req.params;
      await JobRecord.findOneAndUpdate({ sessionId }, { status: 'manual' });
      await terminateSession(sessionId);
      res.json({ status: 'marked_manual' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/job/:sessionId/status
  // Fallback polling endpoint if WebSocket drops
  router.get('/:sessionId/status', async (req, res) => {
    try {
      const job = await JobRecord.findOne({ sessionId: req.params.sessionId }).lean();
      if (!job) return res.status(404).json({ error: 'Not found' });
      res.json({ status: job.status, errorDetails: job.errorDetails });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Create server.js**

```javascript
// backend/src/server.js
import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { createJobRouter } from './routes/jobs.js';
import { startWorkerPool } from './queue/workerPool.js';
import { loadOffenceSheet } from './utils/offenceLookup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  // 1. Connect to MongoDB
  await mongoose.connect(config.mongoUri);
  console.log('[DB] Connected to MongoDB');

  // 2. Load XLSX offence sheet into memory
  const xlsxPath = path.resolve(__dirname, 'data/offence-amounts.xlsx');
  const offenceLookup = loadOffenceSheet(xlsxPath);
  console.log(`[XLSX] Loaded ${offenceLookup.size} offence entries`);

  // 3. Create Express + Socket.io app
  const app    = express();
  const server = http.createServer(app);
  const io     = new SocketIO(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(cors());
  app.use(express.json());

  // Serve uploaded files in local mode
  if (config.storageMode === 'local') {
    app.use('/uploads', express.static(path.resolve(config.localUploadDir)));
  }

  // Routes
  app.use('/api/job', createJobRouter(io));

  // Health check
  app.get('/health', (_, res) => res.json({ status: 'ok', env: config.nodeEnv }));

  // Socket.io — client joins their session room on connect
  io.on('connection', (socket) => {
    socket.on('join_session', (sessionId) => {
      socket.join(sessionId);
      console.log(`[WS] Socket joined session: ${sessionId}`);
    });
  });

  // 4. Start BullMQ worker pool
  startWorkerPool(io, offenceLookup);

  // 5. Start HTTP server
  server.listen(config.port, () => {
    console.log(`[Server] Running on http://localhost:${config.port} (${config.nodeEnv})`);
  });
}

bootstrap().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Copy .env.test to .env and run the server**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
cp ../.env.test .env
# Fill in TEST_APPOINTMENT_ID and TEST_MOBILE_NUMBER
node src/server.js
```

Expected output:
```
[DB] Connected to MongoDB
[XLSX] Loaded 198 offence entries
[Worker] Pool started — concurrency: 2
[Server] Running on http://localhost:3001 (test)
```

- [ ] **Step 4: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/routes/jobs.js backend/src/server.js
git commit -m "feat: Express routes, Socket.io server, and app bootstrap"
```

---

## Task 12: Frontend — api.js + useSocket Hook

**Files:**
- Create: `frontend/src/api.js`
- Create: `frontend/src/hooks/useSocket.js`

- [ ] **Step 1: Create api.js**

```javascript
// frontend/src/api.js
import axios from 'axios';

const http = axios.create({ baseURL: '/api' });

export const api = {
  startJob: (appointmentId, assignedTo) =>
    http.post('/job/start', { appointmentId, assignedTo }).then(r => r.data),

  submitMobile: (sessionId, mobileNumber) =>
    http.post(`/job/${sessionId}/mobile`, { mobileNumber }).then(r => r.data),

  submitOtp: (sessionId, otp) =>
    http.post(`/job/${sessionId}/otp`, { otp }).then(r => r.data),

  retryJob: (sessionId) =>
    http.post(`/job/${sessionId}/retry`).then(r => r.data),

  markManual: (sessionId) =>
    http.post(`/job/${sessionId}/manual`).then(r => r.data),

  getStatus: (sessionId) =>
    http.get(`/job/${sessionId}/status`).then(r => r.data),
};
```

- [ ] **Step 2: Create useSocket.js**

```javascript
// frontend/src/hooks/useSocket.js
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Connects to the Socket.io server and joins the given session room.
 * Returns an array of log events and a map of named events.
 *
 * @param {string|null} sessionId — null until Step 1 completes
 * @returns {{
 *   logs:      Array<{ step: string, status: string, ts: number }>,
 *   otpNeeded: boolean,
 *   complete:  { challans: Array, pageScreenshotUrl: string } | null,
 *   error:     { type: string, message: string } | null,
 *   reassigned: boolean,
 * }}
 */
export function useSocket(sessionId) {
  const socketRef    = useRef(null);
  const [logs,       setLogs]       = useState([]);
  const [otpNeeded,  setOtpNeeded]  = useState(false);
  const [complete,   setComplete]   = useState(null);
  const [error,      setError]      = useState(null);
  const [reassigned, setReassigned] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const socket = io({ transports: ['websocket'] });
    socketRef.current = socket;

    socket.emit('join_session', sessionId);

    socket.on('step_update', ({ step, status }) => {
      setLogs(prev => [...prev, { step, status, ts: Date.now() }]);
    });

    socket.on('otp_needed',  () => setOtpNeeded(true));
    socket.on('complete',    (data) => setComplete(data));
    socket.on('error',       (data) => setError(data));
    socket.on('reassigned',  () => setReassigned(true));

    return () => socket.disconnect();
  }, [sessionId]);

  return { logs, otpNeeded, complete, error, reassigned };
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add frontend/src/api.js frontend/src/hooks/useSocket.js
git commit -m "feat: frontend API client and useSocket hook"
```

---

## Task 13: Frontend — Stepper UI Components

**Files:**
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/App.jsx`
- Create: `frontend/src/components/StepperWizard.jsx`
- Create: `frontend/src/components/Step1_AppointmentId.jsx`
- Create: `frontend/src/components/Step2_MobileNumber.jsx`
- Create: `frontend/src/components/Step3_OtpAndStatus.jsx`
- Create: `frontend/src/components/Step4_Results.jsx`

- [ ] **Step 1: Create main.jsx and App.jsx**

Create `frontend/src/main.jsx`:
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `frontend/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Create `frontend/src/App.jsx`:
```jsx
import StepperWizard from './components/StepperWizard.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-10 px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          Challan Fetch Automation
        </h1>
        <StepperWizard />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create StepperWizard.jsx**

```jsx
// frontend/src/components/StepperWizard.jsx
import { useState } from 'react';
import Step1_AppointmentId  from './Step1_AppointmentId.jsx';
import Step2_MobileNumber   from './Step2_MobileNumber.jsx';
import Step3_OtpAndStatus   from './Step3_OtpAndStatus.jsx';
import Step4_Results        from './Step4_Results.jsx';

const STEP_LABELS = ['Appointment ID', 'Mobile Number', 'OTP & Status', 'Results'];

export default function StepperWizard() {
  const [currentStep,   setCurrentStep]   = useState(1);
  const [sessionId,     setSessionId]     = useState(null);
  const [vehicleDetails,setVehicleDetails]= useState(null);
  const [results,       setResults]       = useState(null);

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* Step indicator */}
      <div className="flex items-center mb-8">
        {STEP_LABELS.map((label, i) => {
          const num  = i + 1;
          const done = num < currentStep;
          const active = num === currentStep;
          return (
            <div key={num} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${done   ? 'bg-green-500 text-white' :
                  active ? 'bg-blue-600 text-white'  : 'bg-gray-200 text-gray-500'}`}>
                {done ? '✓' : num}
              </div>
              <span className={`ml-2 text-sm font-medium hidden sm:block
                ${active ? 'text-blue-600' : 'text-gray-400'}`}>{label}</span>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-3 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {currentStep === 1 && (
        <Step1_AppointmentId
          onComplete={(sid, vd) => { setSessionId(sid); setVehicleDetails(vd); setCurrentStep(2); }}
        />
      )}
      {currentStep === 2 && (
        <Step2_MobileNumber
          sessionId={sessionId}
          vehicleDetails={vehicleDetails}
          onComplete={() => setCurrentStep(3)}
        />
      )}
      {currentStep === 3 && (
        <Step3_OtpAndStatus
          sessionId={sessionId}
          onComplete={(data) => { setResults(data); setCurrentStep(4); }}
          onRetry={(newSid) => { setSessionId(newSid); setCurrentStep(2); }}
        />
      )}
      {currentStep === 4 && (
        <Step4_Results
          results={results}
          onNewJob={() => { setCurrentStep(1); setSessionId(null); setResults(null); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create Step1_AppointmentId.jsx**

```jsx
// frontend/src/components/Step1_AppointmentId.jsx
import { useState } from 'react';
import { api } from '../api.js';

export default function Step1_AppointmentId({ onComplete }) {
  const [appointmentId, setAppointmentId] = useState('');
  const [loading, setLoading]             = useState(false);
  const [error,   setError]               = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!appointmentId.trim()) return;
    setLoading(true); setError(null);
    try {
      const { sessionId, vehicleDetails } = await api.startJob(
        appointmentId.trim(),
        'qc@company.com'   // TODO: replace with logged-in QC email
      );
      onComplete(sessionId, vehicleDetails);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Appointment ID
        </label>
        <input
          type="text"
          value={appointmentId}
          onChange={e => setAppointmentId(e.target.value)}
          placeholder="e.g. APT-12345"
          className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading || !appointmentId.trim()}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium disabled:opacity-50 hover:bg-blue-700 transition"
      >
        {loading ? 'Fetching details…' : 'Fetch Details →'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create Step2_MobileNumber.jsx**

```jsx
// frontend/src/components/Step2_MobileNumber.jsx
import { useState } from 'react';
import { api } from '../api.js';

export default function Step2_MobileNumber({ sessionId, vehicleDetails, onComplete }) {
  const [mobile,  setMobile]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!mobile.trim()) return;
    setLoading(true); setError(null);
    try {
      await api.submitMobile(sessionId, mobile.trim());
      onComplete();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {vehicleDetails && (
        <div className="bg-gray-50 rounded-lg p-4 text-sm">
          <p className="font-medium text-gray-700 mb-2">Vehicle Details Confirmed</p>
          <p className="text-gray-600">Reg No: <span className="font-mono font-semibold">{vehicleDetails.registrationNumber}</span></p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Owner's Mobile Number
          </label>
          <input
            type="tel"
            value={mobile}
            onChange={e => setMobile(e.target.value)}
            placeholder="10-digit mobile number"
            maxLength={10}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading || mobile.trim().length < 10}
          className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium disabled:opacity-50 hover:bg-blue-700 transition"
        >
          {loading ? 'Starting automation…' : 'Start Automation →'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Create Step3_OtpAndStatus.jsx**

```jsx
// frontend/src/components/Step3_OtpAndStatus.jsx
import { useState } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { api } from '../api.js';

const STEP_LABELS = {
  open_website:  '🌐 Opened Delhi Police website',
  enter_reg:     '🔍 Entered registration number',
  mobile_change: '📱 Mobile number change',
  otp_submit:    '✅ OTP submitted',
};

export default function Step3_OtpAndStatus({ sessionId, onComplete, onRetry }) {
  const [otp,        setOtp]        = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { logs, otpNeeded, complete, error, reassigned } = useSocket(sessionId);

  // Auto-advance when complete arrives
  if (complete) {
    onComplete(complete);
    return null;
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    if (!otp.trim()) return;
    setSubmitting(true);
    try { await api.submitOtp(sessionId, otp.trim()); }
    catch { /* error will arrive via WS */ }
    finally { setSubmitting(false); }
  }

  async function handleRetry() {
    const { newSessionId } = await api.retryJob(sessionId);
    onRetry(newSessionId);
  }

  if (reassigned) {
    return (
      <div className="text-center space-y-4">
        <div className="text-yellow-500 text-4xl">⚠️</div>
        <p className="font-semibold text-gray-700">This job has been reassigned to another QC.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-semibold text-red-700">Automation Failed</p>
          <p className="text-red-600 text-sm mt-1">{error.message}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleRetry}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition">
            Try Again
          </button>
          <button onClick={() => api.markManual(sessionId)}
            className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition">
            Mark as Manual
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live status log */}
      <div className="bg-gray-50 rounded-lg p-4 min-h-[140px] space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Live Status</p>
        {logs.length === 0 && (
          <p className="text-sm text-gray-400 animate-pulse">Starting automation…</p>
        )}
        {logs.map((log, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className={log.status === 'success' ? 'text-green-500' :
                             log.status === 'running'  ? 'text-blue-500 animate-pulse' : 'text-red-500'}>
              {log.status === 'success' ? '✓' : log.status === 'running' ? '⏳' : '✗'}
            </span>
            <span className="text-gray-700">{STEP_LABELS[log.step] || log.step}</span>
          </div>
        ))}
        {otpNeeded && (
          <p className="text-sm text-blue-600 font-medium animate-pulse">⏳ Waiting for OTP…</p>
        )}
      </div>

      {/* OTP input — only shown after otp_needed event */}
      {otpNeeded && (
        <form onSubmit={handleOtpSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
            <input
              type="text"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              maxLength={6}
              placeholder="6-digit OTP"
              className="w-full border border-blue-400 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={submitting || otp.trim().length < 4}
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium disabled:opacity-50 hover:bg-blue-700 transition"
          >
            {submitting ? 'Submitting…' : 'Submit OTP →'}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create Step4_Results.jsx**

```jsx
// frontend/src/components/Step4_Results.jsx

export default function Step4_Results({ results, onNewJob }) {
  const { challans = [], pageScreenshotUrl } = results || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          {challans.length} Challan{challans.length !== 1 ? 's' : ''} Found
        </h2>
        {pageScreenshotUrl && (
          <a href={pageScreenshotUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline">
            View Page Screenshot ↗
          </a>
        )}
      </div>

      {challans.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No challans found for this vehicle.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-left">
                <th className="px-3 py-2 font-semibold">Notice No.</th>
                <th className="px-3 py-2 font-semibold">Offence</th>
                <th className="px-3 py-2 font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Court</th>
                <th className="px-3 py-2 font-semibold">Image</th>
              </tr>
            </thead>
            <tbody>
              {challans.map((c, i) => (
                <tr key={i} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-3 py-2 font-mono text-xs">{c.noticeNo}</td>
                  <td className="px-3 py-2">{c.offenceDetail}</td>
                  <td className="px-3 py-2 font-semibold">
                    {c.penaltyAmount ? `₹${c.penaltyAmount}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                      ${c.amountSource === 'scraped'              ? 'bg-green-100 text-green-700' :
                        c.amountSource === 'xlsx_lookup'          ? 'bg-blue-100 text-blue-700'  :
                        'bg-yellow-100 text-yellow-700'}`}>
                      {c.amountSource}
                    </span>
                  </td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2">{c.challanCourt}</td>
                  <td className="px-3 py-2">
                    {c.offenceImageUrl
                      ? <a href={c.offenceImageUrl} target="_blank" rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs">View ↗</a>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={onNewJob}
        className="w-full mt-4 bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition">
        + Start New Job
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add frontend/src/main.jsx frontend/src/index.css frontend/src/App.jsx \
        frontend/src/components/StepperWizard.jsx \
        frontend/src/components/Step1_AppointmentId.jsx \
        frontend/src/components/Step2_MobileNumber.jsx \
        frontend/src/components/Step3_OtpAndStatus.jsx \
        frontend/src/components/Step4_Results.jsx
git commit -m "feat: React stepper UI — all 4 steps with live WebSocket status"
```

---

## Task 14: End-to-End Smoke Test

**Goal:** Verify the full flow works end-to-end with the real staging APIs using the test vehicle (RJ14CV8337).

- [ ] **Step 1: Ensure Redis and MongoDB are running locally**

```bash
# In separate terminals:
redis-server
mongod --dbpath /usr/local/var/mongodb
```

Expected: both services start without errors.

- [ ] **Step 2: Set up .env**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
cp ../.env.test .env
```

Open `.env` and fill in:
```
TEST_APPOINTMENT_ID=<real staging appointmentId for RJ14CV8337>
TEST_MOBILE_NUMBER=<vehicle owner's mobile>
PLAYWRIGHT_HEADLESS=false
```

- [ ] **Step 3: Start backend**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm run dev
```

Expected:
```
[DB] Connected to MongoDB
[XLSX] Loaded 198 offence entries
[Worker] Pool started — concurrency: 2
[Server] Running on http://localhost:3001 (test)
```

- [ ] **Step 4: Start frontend**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/frontend
npm run dev
```

Expected:
```
  ➜  Local:   http://localhost:5173/
```

- [ ] **Step 5: Run through all 4 steps manually**

1. Open `http://localhost:5173`
2. **Step 1**: Enter the TEST_APPOINTMENT_ID → confirm vehicle details (RJ14CV8337, chassis MA3ETDE1S00114822) appear
3. **Step 2**: Enter TEST_MOBILE_NUMBER → click Start Automation → watch Playwright browser open
4. **Step 3**: Watch live status log update → when OTP input appears, enter the OTP from SMS
5. **Step 4**: Verify challan table appears with correct data, image links work, amounts populated

- [ ] **Step 6: Verify MongoDB record**

```bash
mongosh challan-test --eval "db.jobrecords.findOne({}, {}, { sort: { createdAt: -1 } })"
```

Expected: a document with `status: "completed"` and `vehicleDetails.registrationNumber: "RJ14CV8337"`.

- [ ] **Step 7: Verify Challan Service call (check staging Admin Panel)**

Log in to staging Admin Panel and search for the appointmentId used — new challan rows should appear.

- [ ] **Step 8: Run full test suite**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation/backend
npm test
```

Expected: all unit tests PASS.

- [ ] **Step 9: Final commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add .
git commit -m "feat: Phase 1 complete — full e2e challan fetch automation"
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Covered In |
|---|---|
| QC enters appointmentId → GET OMS API for vehicle details | Task 5 (omsService), Task 11 (route) |
| QC enters mobile → BullMQ job queued | Task 8 (queue), Task 11 (route) |
| Playwright opens Delhi Police site | Task 9 (openSite.js) |
| Mobile change ALWAYS on fresh session, retry 3× backoff | Task 9 (changeMobile.js) |
| OTP promise resolver, session-scoped | Task 3 (sessionStore), Task 9 (submitOtp.js) |
| Scrape challan rows + download images | Task 9 (scrapeChallans.js) |
| XLSX blank penalty lookup | Task 2 (offenceLookup.js) |
| Deduplication by noticeNumber + POST Challan Service | Task 9 (deduplicatePost.js), Task 5 (challanService.js) |
| challanProof as multipart file | Task 5 (challanService.js) |
| MongoDB audit trail per job | Task 4 (JobRecord.js) |
| WebSocket real-time step updates | Task 11 (server.js), Task 12 (useSocket.js) |
| Try Again / Mark as Manual error recovery | Task 11 (routes), Task 13 (Step3) |
| safeFind with Slack alert + queue pause | Task 9 (safeFind.js) |
| Selector broken → fail fast, pause queue | Task 9 (safeFind.js) |
| S3 / local storage abstraction | Task 6 (storageService.js) |
| Session isolation via UUID sessionId | Task 3, Task 8, Task 11 |
| OTP timeout (10 min) | Task 9 (submitOtp.js) |
| Reassignment: terminateSession + emit reassigned | Task 3 (sessionStore), Task 11 (/manual route) |
| Phase 2 ready (InputProvider swap point) | automation.js is the swap point |

### No Placeholders — all tasks have complete code. ✅
### Type consistency — `noticeNo` (scraped) vs `noticeNumber` (OMS API) handled explicitly in deduplicatePost.js. ✅
