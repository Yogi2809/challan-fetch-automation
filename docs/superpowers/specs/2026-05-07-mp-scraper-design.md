# MP eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://echallan.mponline.gov.in/
- **Scraper ID:** `mp`
- **Label:** MP eChallan
- **Challan Court:** `Madhya Pradesh Police Department`

---

## 1. Overview

The Madhya Pradesh scraper fetches eChallan data from the MPOnline government portal. The site is a Vue.js SPA. It requires a **human-solved image CAPTCHA** (human-in-the-loop via the operator UI) before results are displayed. The CAPTCHA loop retries indefinitely until the operator provides the correct text. Results are presented as a list of challan rows in a styled table.

**Authentication:** None
**CAPTCHA:** Alphanumeric image CAPTCHA (human-in-the-loop)
**requiresOtp:** `false`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate to portal | `https://echallan.mponline.gov.in/` |
| 2 | Wait for Vue app to render vehicle input | `.vehicleno` (20 s timeout) |
| 3 | Fill registration number (uppercased) | `.vehicleno` |
| 4 | Emit status and enter CAPTCHA loop | — |

---

## 3. No-Challans Case

Detected inside `solveCaptcha()` in `steps/solveCaptcha.js`:

- After a correct CAPTCHA, the site shows a SweetAlert2 dialog whose text matches `/no challan found|no challan data|keep drive safely/i`.
- `solveCaptcha()` returns the string `'no_challans'`.
- `run()` receives `'no_challans'` and returns `[]`.

Status message: `"No challans found on MP eChallan portal."`

A "Loading…" swal can appear first and auto-dismiss before the real response swal — `solveCaptcha()` handles this two-phase wait.

---

## 4. Scraping Flow (main loop)

`solveCaptcha()` returns `'found'` when `.detail_area` becomes visible, then:

1. Locate all rows matching `table.challan_table-Fee` (one element per challan).
2. For each row:
   a. Read challan number from `a[target="_blank"]` link text; skip if empty.
   b. Read amount from `td[data-label="Offence Penalty:"]`.
   c. **Determine ONLINE/OFFLINE** by probing the checkbox:
      - Locate `input[type="checkbox"][title="Click to pay"]` inside the row.
      - If present and not disabled: click it; if it becomes checked → `ONLINE`, restore unchecked state. Otherwise → `OFFLINE`.
   d. Apply PII mask to challan number links in the full table (`table.challan_table-Fee a[target="_blank"]`).
   e. Screenshot the row element; remove mask.
   f. Derive offence date from challan number via `parseMPDate()` (see §5).
   g. Push result row.

---

## 5. Field Mapping

| Output Field | Source | Notes |
|---|---|---|
| `noticeNo` | `a[target="_blank"]` text content | Challan ID from the site |
| `vehicleNumber` | `registrationNumber.toUpperCase()` | From context |
| `offenceDate` | `parseMPDate(challanNo)` | Derived from challan number prefix (see below) |
| `offenceDetail` | Constant | `"MP Challan Site"` — site does not expose offence type |
| `offenceLocation` | Constant | `""` — not shown on portal |
| `penaltyAmount` | `td[data-label="Offence Penalty:"]` → `parseAmount()` | Strips `₹`, spaces, commas, `/`, `-` |
| `status` | Constant | Always `"Unpaid"` |
| `challanType` | Checkbox probe | `"ONLINE"` if checkbox is clickable + checkable; else `"OFFLINE"` |
| `challanCourt` | Constant | `"Madhya Pradesh Police Department"` |
| `imageBuffer` | Row screenshot | PII-masked, falls back to full-page if row screenshot fails |

### Date parsing (`parseMPDate`)

The challan number encodes the date in one of two formats after stripping a leading alpha prefix:

| Format | Example | Parsing rule |
|---|---|---|
| 8 digits: `YYYYMMDD` | `SPD20220812xxx` → `20220812` | → `"2022-08-12"` |
| 6 digits: `DDMMYY` | `ITMSUJN120422xxx` → `120422` | → `"2022-04-12"` |
| Other | Any other prefix/length | Returns `""` |

### Amount parser

`/[₹\s,/-]/g` removed from raw string, then `.trim()`.

---

## 6. CAPTCHA Handling

The CAPTCHA flow is implemented in `backend/src/worker/steps/solveCaptcha.js`.

| Phase | Detail |
|---|---|
| Selector — image | `.cap_img img` |
| Selector — text input | `.captcha_text` |
| Selector — search button | `.reset_ec_btn` |
| Selector — results area | `.detail_area` |
| Selector — SweetAlert dialog | `.swal2-container` |
| Image capture | `page.locator('.cap_img img').screenshot()` → base64 |
| Resolver registration | `captchaResolvers.set(sessionId, resolve)` registered **before** `onCaptchaRequired()` to avoid race |
| Operator input | `onCaptchaRequired(base64)` emits image to UI; promise resolves when operator submits text |
| Submit | `page.fill('.captcha_text', text)` then `page.click('.reset_ec_btn')` |
| Outcome detection | Race: `.detail_area` (found), `.swal2-container` (dialog), `/no challan.../i` in body text (no_challans), timeout |
| Loading swal | If first swal text matches `/loading/i`, wait for it to disappear, then re-race for final result |
| Wrong CAPTCHA | Any non-"no challan" dialog text → dismiss `.swal2-confirm`, wait 800 ms, retry |
| Retry count | Unlimited — loops until `'found'` or `'no_challans'` |
| Timeout guard | Throws `"Timed out waiting for MP eChallan search result"` if race fully times out |

---

## 7. PII Masking Rules

| Selector | What it hides |
|---|---|
| `table.challan_table-Fee a[target="_blank"]` | Challan number links across all rows |

Applied per-row: mask → row screenshot → cleanup. The mask covers all challan number links on the page simultaneously but is applied and removed once per row iteration (so each row's screenshot has all numbers hidden).

---

## 8. Error Handling

| Condition | Behaviour |
|---|---|
| `'no_challans'` from `solveCaptcha()` | Returns `[]` |
| CAPTCHA image element not found (15 s) | Throws `"Could not capture CAPTCHA image"` |
| Vue app doesn't render `.vehicleno` (20 s) | `waitForSelector` timeout propagated |
| Wrong CAPTCHA (swal dialog) | Dismiss and retry indefinitely |
| Race fully times out after submit | Throws `"Timed out waiting for MP eChallan search result"` |
| Row screenshot fails | Falls back to `page.screenshot({ fullPage: false })` via `.catch()` |
| Challan number empty in a row | Row skipped (`continue`) |

---

## 9. Files

| File | Role |
|---|---|
| `backend/src/worker/scrapers/mp/index.js` | Entry point — exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/worker/steps/solveCaptcha.js` | Full CAPTCHA loop: image capture, UI emit, operator input, submit, outcome detection |
| `backend/src/utils/maskPII.js` | `applyPIIMasks()` utility |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 3 unpaid MP challans | Array of 3 rows with correct amounts and dates |
| Vehicle with no challans | `solveCaptcha()` returns `'no_challans'`; `run()` returns `[]` |
| First CAPTCHA wrong, second correct | First attempt: dialog dismissed and retried; second attempt: results loaded |
| Challan number `"SPD20221015ABC"` | `offenceDate === "2022-10-15"` |
| Challan number `"ITMSUJN120422XY"` | `offenceDate === "2022-04-12"` |
| Row with enabled checkbox that can be checked | `challanType === "ONLINE"` |
| Row with no checkbox or disabled checkbox | `challanType === "OFFLINE"` |
| Raw amount `"₹ 1,000 /-"` | `penaltyAmount === "1000"` |
| Loading swal appears before result swal | Handled by two-phase wait in `solveCaptcha()`; final outcome detected correctly |
