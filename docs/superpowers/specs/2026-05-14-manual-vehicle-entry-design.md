# Manual Vehicle Entry — Temporary Test Mode Design

## Goal

Allow QC operators (and other teams for testing) to run the full 9-scraper challan fetch flow by entering vehicle details directly on the UI, without needing an Appointment ID. The flow ends at the Pending Challans tab — no submission to the admin panel during testing.

## Scope

This is a **temporary change** for internal team testing. The production appointment-based flow must be fully preserved and easy to restore.

---

## What Changes

### Frontend — `AppointmentForm.jsx`
Replace the single Appointment ID field with four required fields + one optional:

| Field | Required | Notes |
|---|---|---|
| Registration Number | Yes | e.g. TS08HV6071 |
| Chassis Number | Yes | e.g. MA3ERLF1S00123456 |
| Engine Number | Yes | e.g. G10BN1234567 |
| Mobile Number | Yes | 10-digit, for Delhi OTP |
| Appointment ID | **No** | Leave blank during testing |

On submit: **no OMS API call**. Calls `onLookupSuccess` directly with entered values:
```js
onLookupSuccess({
  appointmentId: appointmentId.trim() || '',
  mobileNumber:  mobileNumber.trim(),
  vehicle: { registrationNumber, chassisNumber, engineNumber }
})
```

`lookupAppointment` in `api.js` is kept untouched — just not called.

### Frontend — `ChallanWizard.jsx`
No change needed. `handleLookupSuccess` already accepts `{ appointmentId, mobileNumber, vehicle }`. The vehicle pill header (masked Reg No, Chassis, Engine) reads from the same shape.

### Backend — `routes/jobs.js`
`POST /job/start` accepts three new optional fields:
```json
{ "appointmentId": "", "mobileNumber": "...", "scraperId": "...",
  "registrationNumber": "TS08HV6071", "chassisNumber": "...", "engineNumber": "..." }
```
`appointmentId` defaults to `''` when blank.

### Backend — `models/JobRecord.js`
Remove `required: true` from `appointmentId` field.

### Backend — `worker/automation.js`
Skip `getVehicleDetails()` when vehicle details are already in the job payload:
```js
const { registrationNumber, chassisNumber, engineNumber } =
  job.data.registrationNumber
    ? job.data
    : await getVehicleDetails(appointmentId);
```
`getVehicleDetails` and `getExistingChallans` in `omsService.js` are untouched.

### Backend — `utils/captchaSolver.js`
Support explicit AWS credentials (with optional session token) as an alternative to SSO:
```js
credentials: process.env.AWS_ACCESS_KEY_ID
  ? {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
    }
  : fromSSO({ profile: process.env.AWS_PROFILE || 'Cars24NonprodYogeshMishra' })
```
Local dev continues using SSO. Deployed server uses env vars.

---

## What Does NOT Change

- `omsService.js` — both functions preserved exactly
- `deduplicatePost.js` — untouched
- Challan POST service — untouched
- All 9 scrapers — untouched
- Pending Challans tab and Submit button — untouched (just not used during testing)
- `api.js` `lookupAppointment` — kept, just not called

---

## AWS Credentials

### Temporary (current — expires every 6 hours)
Set three env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`.
Must be manually refreshed from the IAM Identity Center console every 6 hours.

### Permanent fix (required before long-term deployment)
Create a dedicated IAM user in the `cars24-nonprod` account with an inline policy:
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::challan-fetch-automation/captcha/*"
}
```
This gives a permanent `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (no session token needed, no expiry).

---

## Deployment — Railway.app (Recommended for team testing)

### Services needed
- Backend Node.js service (this repo)
- Redis (Railway add-on)
- MongoDB (MongoDB Atlas free tier, or Railway add-on)

### Build command additions
```bash
npx playwright install chromium --with-deps
```

### Environment variables to set in Railway dashboard
All variables from `backend/.env`, plus:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` (update every 6 hours until permanent IAM user is set up)

### GitHub repo
`https://github.com/Yogi2809/challan-fetch-automation`

Push code → Railway auto-deploys on every push to main.

### What NOT to do
- Never commit `.env` to git — use Railway's dashboard for secrets
- Never commit `AWS_SESSION_TOKEN` to git — it's a temporary credential
- Never use production OMS/Challan Service URLs — keep staging
- Never expose backend env vars in the frontend bundle

---

## Reversibility

To restore the production appointment-based flow:
1. Revert `AppointmentForm.jsx` to the original (add back Appointment ID field, remove manual fields, restore `lookupAppointment` call)
2. Revert the one-line change in `automation.js` (always call `getVehicleDetails`)
3. Revert `JobRecord.js` `required: true` on `appointmentId`
4. Revert `routes/jobs.js` to not accept vehicle fields in body

All other files (scrapers, services, deduplication, challan POST) need zero changes in either direction.
