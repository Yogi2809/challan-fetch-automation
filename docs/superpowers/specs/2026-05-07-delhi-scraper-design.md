# Delhi Traffic Police eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://traffic.delhipolice.gov.in/notice/pay-notice
- **Scraper ID:** `delhi`
- **Label:** Delhi Traffic Police
- **Challan Court:** `Delhi(Traffic Department)`

---

## 1. Overview

The Delhi scraper fetches pending traffic notices from the Delhi Traffic Police self-service portal. Unlike the Gujarat/Surat scrapers it requires the user to authenticate via OTP because the site gates challan details behind a registered mobile number. The scraper must also handle a "Change Mobile Number" flow to redirect the OTP to the operator's number before the OTP can be intercepted.

The scraper **always runs** for any vehicle — a vehicle registered in any state can accumulate Delhi challans.

**Authentication:** OTP (human-in-the-loop via UI)
**CAPTCHA:** None
**requiresOtp:** `true`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate to pay-notice page | `https://traffic.delhipolice.gov.in/notice/pay-notice` |
| 2 | Wait for vehicle input | `#vehicle_number` |
| 3 | Fill registration number | `#vehicle_number` |
| 4 | Click Search Details | `#submit1` |
| 5 | Race: wait for OTP modal or "No Record Found" text | `#otp` vs `text=No Record Found` |
| 6 | Click "Change mobile Number" link | `a:has-text("Change mobile Number")` |
| 7 | Fill new mobile, confirm mobile | `#number`, `#confirm-number` |
| 8 | Fill chassis last 4 digits | `#chasis` |
| 9 | Fill engine last 4 digits | `#engine` |
| 10 | Click swal2 Confirm button | `.swal2-confirm` |
| 11 | Wait for "Details Updated" modal, click OK | `.swal2-confirm` |
| 12 | Re-click Search Details (OTP now sent to operator mobile) | `#submit1` |
| 13 | Emit `onOtpRequired(CHALLAN_COURT)` — UI prompts operator | — |
| 14 | Wait for OTP entry (no timeout), fill 6-digit OTP | `#otp` |
| 15 | Click swal2 Confirm to submit OTP | `.swal2-confirm` |
| 16 | Scrape results table | `table tbody tr` |

**Input requirements:** `registrationNumber`, `mobileNumber`, `chassisLast4`, `engineLast4`

---

## 3. No-Challans Case

Two paths lead to an empty result:

1. **Before OTP — "No Record Found":** `changeMobile.js` races `#otp` against `text=No Record Found`. If the no-record text wins, an error with `err.noRecords = true` is thrown. The `run()` function catches it and returns `[]`.

2. **After OTP — "No Record Found":** `scrapeChallans.js` races `table tbody tr` against `text=No Record Found`. If no-record wins (or the race times out), returns `[]`.

Status message emitted: `"No pending notices found for this vehicle on Delhi Traffic Police."`

---

## 4. Scraping Flow (main loop)

After successful OTP submission the site renders a table of notices.

1. `scrapeChallans()` races `table tbody tr` vs `text=No Record Found` (30 s timeout).
2. Apply PII masks to columns 1 & 2 of the results table before taking a full-page screenshot.
3. Iterate over all `table tbody tr` rows:
   - Skip rows with fewer than 10 cells.
   - Skip rows where `cells[0]` (Notice No) is empty.
4. For each valid row, attempt to open the challan image:
   - Click the image/link in `td:nth-child(6)`.
   - Capture the new tab's screenshot.
   - Close the tab.
   - Fall back to the masked full-page screenshot if the tab fails.
5. Determine `challanType` from `cells[9]` (Make Payment column): `"pay now"` or `"virtual court"` → `ONLINE`; anything else → `OFFLINE`.

**OTP resend:** A resend handler is registered via `resendHandlers.set(sessionId, fn)` which calls `a[onclick="resendOtp()"]` on the live page. The response message is read from `#otp_msg`.

---

## 5. Field Mapping

| Output Field | Source (`cells[i]`) | Notes |
|---|---|---|
| `noticeNo` | `cells[0]` | Notice number |
| `vehicleNumber` | `cells[1]` | As returned by site (also stored as-entered) |
| `offenceDate` | `cells[2]` (first 10 chars) | Site format: `YYYY-MM-DD HH:MM:SS` → sliced to date |
| `offenceLocation` | `cells[3]` | Place of offence |
| `offenceDetail` | `cells[4]` | Violation description |
| `penaltyAmount` | `cells[6]` | Raw string from site |
| `status` | `cells[7]` | e.g. `"Unpaid"` |
| `challanType` | `cells[9]` (Make Payment text) | `"pay now"` / `"virtual court"` → `ONLINE`; else `OFFLINE` |
| `challanCourt` | Constant | `"Delhi(Traffic Department)"` |
| `imageBuffer` | New-tab screenshot OR full-page fallback | PII-masked |

---

## 6. OTP Handling

| Phase | Detail |
|---|---|
| Trigger | After `changeMobile()` succeeds the scraper calls `onOtpRequired(CHALLAN_COURT)` which updates DB state to `awaiting_otp` and emits a socket event to the UI with the site label. |
| Input | Operator types 6-digit OTP in the UI; resolved via `otpResolvers.get(sessionId)` promise. |
| Submit | OTP filled into `#otp`; `.swal2-confirm` clicked to submit. |
| Resend | Operator can click Resend in UI; handler calls `a[onclick="resendOtp()"]` on the browser page and returns the text from `#otp_msg`. |
| Timeout | No timeout on the OTP wait — waits indefinitely for operator input. |

---

## 7. PII Masking Rules

| Element | Selector | What it hides |
|---|---|---|
| Notice number column | `table tbody tr td:nth-child(1)` | Challan/notice number |
| Vehicle number column | `table tbody tr td:nth-child(2)` | Registration plate |

Masks applied via `applyPIIMasks()` before the full-page screenshot is captured. Masks are removed after screenshot via the returned `cleanup()` function.

---

## 8. Error Handling

| Condition | Behaviour |
|---|---|
| `text=No Record Found` before OTP | `changeMobile()` throws `{ noRecords: true }`; `run()` catches and returns `[]` |
| `text=No Record Found` after OTP | `scrapeChallans()` returns `[]` |
| Race timeout in `changeMobile()` | Throws `"Timed out waiting for OTP page or results after Search Details"` |
| Race timeout in `scrapeChallans()` | Emits status and returns `[]` |
| Image tab click fails | Falls back to the pre-captured full-page screenshot |
| `safeFind()` can't locate a selector | Throws session-aware error (propagated to caller) |

---

## 9. Files

| File | Role |
|---|---|
| `backend/src/worker/scrapers/delhi/index.js` | Entry point — exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/worker/steps/openSite.js` | Navigates to site and submits vehicle number |
| `backend/src/worker/steps/changeMobile.js` | Handles "Change Mobile Number" flow and chassis/engine verification |
| `backend/src/worker/steps/submitOtp.js` | Waits for operator OTP, fills and submits; registers resend handler |
| `backend/src/worker/steps/scrapeChallans.js` | Scrapes the results table; applies PII masks; opens image tabs |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 2 pending Delhi notices | `[]` of length 2 returned; each row has `challanType` set correctly |
| Vehicle with no Delhi notices (pre-OTP) | `err.noRecords` caught; returns `[]`; no OTP prompt shown |
| Vehicle with no Delhi notices (post-OTP) | `scrapeChallans` returns `[]` |
| Row with `cells[9] === "Pay Now"` | `challanType === "ONLINE"` |
| Row with `cells[9] === "Court"` | `challanType === "OFFLINE"` |
| Image tab opens successfully | `imageBuffer` is tab screenshot |
| Image tab fails to open | `imageBuffer` falls back to full-page screenshot |
| OTP resend requested | `a[onclick="resendOtp()"]` clicked; resend message returned from `#otp_msg` |
