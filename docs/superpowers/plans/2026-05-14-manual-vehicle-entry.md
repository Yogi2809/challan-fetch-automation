# Manual Vehicle Entry (Temporary Test Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow testers to enter vehicle details directly on the UI and run the full 9-scraper challan fetch flow without an Appointment ID or OMS API call.

**Architecture:** Replace the AppointmentForm's single Appointment ID field with manual Reg No / Chassis / Engine inputs; skip the OMS vehicle lookup on both frontend and backend worker; pass explicit AWS credentials (with session token) so S3 works on any machine without SSO. All production code paths are preserved untouched.

**Tech Stack:** React, Express, Mongoose, AWS SDK v3, Playwright, BullMQ, GitHub (push to main)

---

## Files Modified

| File | Change |
|---|---|
| `backend/.env` | Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN |
| `backend/src/utils/captchaSolver.js` | Prefer explicit env-var credentials over SSO; support session token |
| `backend/src/models/JobRecord.js` | Remove `required: true` from `appointmentId` |
| `backend/src/routes/jobs.js` | Accept `registrationNumber`, `chassisNumber`, `engineNumber` in POST /start body |
| `backend/src/worker/automation.js` | Skip `getVehicleDetails()` when vehicle details already in job data |
| `frontend/src/components/AppointmentForm.jsx` | Replace Appointment ID with Reg No + Chassis + Engine fields; keep Appointment ID optional; remove OMS lookup call |

---

### Task 1: Add AWS credentials to .env and fix captchaSolver to use them

**Files:**
- Modify: `backend/.env`
- Modify: `backend/src/utils/captchaSolver.js:1-15`

- [ ] **Step 1: Add credentials to .env**

Add these lines to `backend/.env` (never commit this file — it's in .gitignore):

```
# Get these from IAM Identity Center → Cars24NonprodYogeshMishra → Get credentials
AWS_ACCESS_KEY_ID=<paste from IAM Identity Center>
AWS_SECRET_ACCESS_KEY=<paste from IAM Identity Center>
AWS_SESSION_TOKEN=<paste from IAM Identity Center>   # expires every 6 hours
```

- [ ] **Step 2: Update captchaSolver.js getS3Client to use explicit credentials when present**

Replace the `getS3Client` function in `backend/src/utils/captchaSolver.js`:

```js
function getS3Client() {
  if (!_s3) {
    const credentials = process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
        }
      : fromSSO({ profile: process.env.AWS_PROFILE || 'Cars24NonprodYogeshMishra' });

    _s3 = new S3Client({
      region:      process.env.AWS_REGION || 'ap-south-1',
      credentials,
    });
  }
  return _s3;
}
```

Also add a reset export so callers can force a new client after credential rotation:

```js
export function resetS3Client() { _s3 = null; }
```

- [ ] **Step 3: Verify S3 upload works with new credentials**

```bash
cd backend
node --input-type=module <<'EOF'
import 'dotenv/config';
import { solveCaptchaWithAI } from './src/utils/captchaSolver.js';
// Just test S3 upload by passing a tiny buffer (won't solve anything real)
const buf = Buffer.from('test');
solveCaptchaWithAI(buf, 'test-session-123')
  .then(v => console.log('AI solved:', v))
  .catch(e => console.error('Error (expected if no real captcha):', e.message));
EOF
```

Expected: error about webhook or image content — NOT about S3 credentials. If you see `InvalidClientTokenId` or `ExpiredToken`, the credentials have already expired and need to be refreshed from the IAM Identity Center console.

- [ ] **Step 4: Commit**

```bash
cd /Users/a39935/Desktop/fetch-challan-info-automation
git add backend/src/utils/captchaSolver.js
git commit -m "fix: support explicit AWS credentials with session token in captchaSolver"
```

Note: `.env` is gitignored — do NOT add it.

---

### Task 2: Make appointmentId optional in JobRecord model

**Files:**
- Modify: `backend/src/models/JobRecord.js`

- [ ] **Step 1: Remove required constraint**

Find the `appointmentId` field in `backend/src/models/JobRecord.js` and change:

```js
// Before
appointmentId: { type: String, required: true },

// After
appointmentId: { type: String, default: '' },
```

- [ ] **Step 2: Restart backend and confirm no startup errors**

```bash
pkill -f "node.*server" 2>/dev/null; sleep 1
cd backend && node src/server.js &
sleep 3 && curl -s http://localhost:3001/api/job/scrapers | head -c 100
```

Expected: JSON array of scrapers (not an error).

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/JobRecord.js
git commit -m "fix: make appointmentId optional in JobRecord for manual test mode"
```

---

### Task 3: Accept vehicle details in POST /job/start

**Files:**
- Modify: `backend/src/routes/jobs.js:43-69`

- [ ] **Step 1: Update the /start route to accept and forward vehicle fields**

Replace the `/start` route body in `backend/src/routes/jobs.js`:

```js
router.post('/start', async (req, res) => {
  const {
    appointmentId, mobileNumber, createdBy, scraperId,
    registrationNumber, chassisNumber, engineNumber,
  } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ error: 'mobileNumber is required' });
  }
  if (!scraperId) {
    return res.status(400).json({ error: 'scraperId is required' });
  }

  const sessionId    = uuidv4();
  const jobCreatedBy = createdBy || 'yogesh.mishra@cars24.com';
  const apptId       = appointmentId?.trim() || '';

  try {
    await JobRecord.create({
      sessionId, appointmentId: apptId, mobileNumber,
      createdBy: jobCreatedBy, scraperId, status: 'queued',
    });
    await challanQueue.add('fetch-challans', {
      sessionId, appointmentId: apptId, mobileNumber,
      createdBy: jobCreatedBy, scraperId,
      registrationNumber, chassisNumber, engineNumber,
    });
    res.json({ sessionId });
  } catch (err) {
    console.error('[start] Failed to create job:', err.message);
    res.status(500).json({ error: 'Failed to start job: ' + err.message });
  }
});
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s -X POST http://localhost:3001/api/job/start \
  -H 'Content-Type: application/json' \
  -d '{"mobileNumber":"9340195867","scraperId":"telangana","registrationNumber":"TS08HV6071","chassisNumber":"MA3TEST123","engineNumber":"ENG123"}' \
  | jq .
```

Expected: `{ "sessionId": "<uuid>" }` — no error.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/jobs.js
git commit -m "feat: accept vehicle details directly in POST /job/start for manual test mode"
```

---

### Task 4: Skip OMS vehicle lookup when vehicle details are in job payload

**Files:**
- Modify: `backend/src/worker/automation.js:50-60`

- [ ] **Step 1: Update automation.js to conditionally skip getVehicleDetails**

Find the block in `backend/src/worker/automation.js` that reads:

```js
emitStatus(`[${scraper.label}] Job started — fetching vehicle details…`);
emitProgress(5);

const vehicle = await getVehicleDetails(appointmentId);
const { registrationNumber, chassisNumber, engineNumber } = vehicle;
```

Replace with:

```js
emitProgress(5);

let registrationNumber, chassisNumber, engineNumber;
if (job.data.registrationNumber) {
  ({ registrationNumber, chassisNumber, engineNumber } = job.data);
  emitStatus(`[${scraper.label}] Job started — using manually entered vehicle details…`);
} else {
  emitStatus(`[${scraper.label}] Job started — fetching vehicle details…`);
  const vehicle = await getVehicleDetails(appointmentId);
  ({ registrationNumber, chassisNumber, engineNumber } = vehicle);
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/worker/automation.js
git commit -m "feat: skip OMS vehicle lookup when registration number provided in job payload"
```

---

### Task 5: Update AppointmentForm UI

**Files:**
- Modify: `frontend/src/components/AppointmentForm.jsx`

- [ ] **Step 1: Replace AppointmentForm with manual vehicle entry form**

Overwrite `frontend/src/components/AppointmentForm.jsx` with:

```jsx
import React, { useState } from 'react';

function ShieldIcon() {
  return (
    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', inputMode, maxLength, prefix }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-slate-400 font-medium select-none">{prefix}</span>
        )}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          autoComplete="off"
          className={`w-full border border-slate-200 rounded-xl py-3 text-[15px] text-slate-900
                     placeholder:text-slate-300 focus:outline-none focus:border-[#4736FE]
                     focus:ring-2 focus:ring-[#4736FE]/15 transition bg-white shadow-sm
                     ${prefix ? 'pl-14 pr-4' : 'px-4'}`}
        />
      </div>
    </div>
  );
}

export default function AppointmentForm({ onLookupSuccess }) {
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [chassisNumber,      setChassisNumber]      = useState('');
  const [engineNumber,       setEngineNumber]       = useState('');
  const [mobileNumber,       setMobileNumber]       = useState('');
  const [appointmentId,      setAppointmentId]      = useState('');
  const [error,              setError]              = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!registrationNumber.trim()) return setError('Registration Number is required');
    if (!chassisNumber.trim())      return setError('Chassis Number is required');
    if (!engineNumber.trim())       return setError('Engine Number is required');
    if (!/^\d{10}$/.test(mobileNumber)) return setError('Enter a valid 10-digit mobile number');

    onLookupSuccess({
      appointmentId: appointmentId.trim(),
      mobileNumber:  mobileNumber.trim(),
      vehicle: {
        registrationNumber: registrationNumber.trim().toUpperCase(),
        chassisNumber:      chassisNumber.trim().toUpperCase(),
        engineNumber:       engineNumber.trim().toUpperCase(),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        label="Registration Number *"
        value={registrationNumber}
        onChange={e => { setRegistrationNumber(e.target.value.toUpperCase()); setError(''); }}
        placeholder="e.g. TS08HV6071"
      />
      <Field
        label="Chassis Number *"
        value={chassisNumber}
        onChange={e => { setChassisNumber(e.target.value.toUpperCase()); setError(''); }}
        placeholder="e.g. MA3ERLF1S00123456"
      />
      <Field
        label="Engine Number *"
        value={engineNumber}
        onChange={e => { setEngineNumber(e.target.value.toUpperCase()); setError(''); }}
        placeholder="e.g. G10BN1234567"
      />
      <Field
        label="Mobile Number *"
        value={mobileNumber}
        onChange={e => { setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
        placeholder="10-digit number"
        type="tel"
        inputMode="numeric"
        maxLength={10}
        prefix="+91"
      />
      <Field
        label="Appointment ID (optional)"
        value={appointmentId}
        onChange={e => { setAppointmentId(e.target.value); setError(''); }}
        placeholder="Leave blank for testing"
      />

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" />
          </svg>
          <p className="text-red-600 text-sm leading-relaxed">{error}</p>
        </div>
      )}

      <button
        type="submit"
        className="w-full text-white rounded-xl py-3.5 text-[15px] font-semibold tracking-tight
                   shadow-sm transition-all flex items-center justify-center gap-2 mt-1
                   hover:opacity-90 active:scale-[0.99]"
        style={{ backgroundColor: '#4736FE' }}
      >
        Start Challan Lookup
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>

      <div className="flex items-center justify-center gap-1.5 pt-1">
        <ShieldIcon />
        <p className="text-[12px] text-slate-400">Sensitive data is masked and never stored in plain text</p>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify frontend starts without errors**

```bash
cd frontend && npm run dev 2>&1 | head -20
```

Expected: `VITE ready` with no compile errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AppointmentForm.jsx
git commit -m "feat: replace appointment ID form with manual vehicle entry for test mode"
```

---

### Task 6: Push to GitHub and verify

- [ ] **Step 1: Check git remote points to the right repo**

```bash
git remote -v
```

Expected: `origin  https://github.com/Yogi2809/challan-fetch-automation.git (fetch/push)`

If missing, add it:
```bash
git remote add origin https://github.com/Yogi2809/challan-fetch-automation.git
```

- [ ] **Step 2: Initialize git if needed and push**

```bash
git push origin main
```

If the repo is empty (first push):
```bash
git push -u origin main
```

- [ ] **Step 3: Confirm push on GitHub**

Open `https://github.com/Yogi2809/challan-fetch-automation` and verify the latest commit appears.

---

## Refreshing AWS credentials (every 6 hours)

When the session token expires, the CAPTCHA auto-solver will show the red SSO-expired banner in the UI. To refresh:

1. Go to the IAM Identity Center portal
2. Click **Get credentials for Cars24NonprodYogeshMishra**
3. Copy the three `export` lines from **Option 1**
4. Update `backend/.env` — replace the three AWS lines
5. Restart the backend: `pkill -f "node.*server"; cd backend && npm run dev`

Once a permanent IAM user is created (by your AWS admin), the `AWS_SESSION_TOKEN` line disappears forever and you only need `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`.
