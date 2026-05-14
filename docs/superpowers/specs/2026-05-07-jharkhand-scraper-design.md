# Jharkhand Traffic Police eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://echallan.jhpolice.gov.in/payment/payonline
- **Scraper ID:** `jharkhand`
- **Label:** Jharkhand Traffic Police
- **Challan Court:** `Jharkhand Traffic Police Department`

---

## 1. Overview

The Jharkhand scraper fetches pending eChallan data from the Jharkhand Police public portal. The site requires an **alphanumeric image CAPTCHA** which is **human-solved** (human-in-the-loop via the operator UI). The scraper allows up to 3 CAPTCHA attempts before throwing an error.

After CAPTCHA success, the scraper performs a two-pass strategy:
1. **Pass 1 (table):** Collect all row metadata (challan number, amount, date, status, pay-button presence) without navigating away.
2. **Pass 2 (View pages):** For each "Pending" challan, click the View button to navigate to its detail page, extract the Act & Section offence text, take a screenshot, then go back.

For challans with `amount = 0`, the final amount is looked up from an offence Excel map (`offenceMap`).

**Authentication:** None
**CAPTCHA:** Alphanumeric image (human-in-the-loop, max 3 attempts)
**requiresOtp:** `false`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate to payment page (`domcontentloaded` + `networkidle`) | `https://echallan.jhpolice.gov.in/payment/payonline` |
| 2 | Select "Vehicle registration no." radio (first radio on page) | `input[type="radio"]:first-of-type` |
| 3 | Dynamically resolve vehicle input selector | See §2a |
| 4 | Fill registration number (uppercased) | Resolved selector |
| 5 | Enter CAPTCHA loop (max 3 attempts) | — |
| 6 | On `'table'` outcome: parse table rows | `table tbody tr, table tr:not(:first-child)` |
| 7 | For each pending challan: click View, extract details, go back | `a:has-text("View"), button:has-text("View")` |

### 2a. Dynamic vehicle input resolution

`page.evaluate()` finds the first `input[type="text"]` whose `placeholder|id|name|className` matches `/JH|EX-JH|vehicle|registration/i`. Falls back to `input[type="text"]:first-of-type`. Selector is returned as `#id`, `input[name="..."]`, or the fallback string.

---

## 3. No-Challans Case

- `*:has-text("Record not available")` / `*:has-text("No record")` visible → `searchOutcome === 'no_record'` → returns `[]`
- `page.waitForFunction(() => /record not available/i.test(document.body.innerText))` fires → same
- After table is found but all rows are non-Pending → `rowData.length === 0` → returns `[]`

Status messages:
- `"No challan record found on Jharkhand Traffic Police portal."`
- `"No pending challans found on Jharkhand Traffic Police portal."`

---

## 4. Scraping Flow

### CAPTCHA loop (max 3 attempts)

1. Capture captcha image using `captureCaptchaImage()` (3-strategy fallback — see §6).
2. Register `captchaResolvers.set(sessionId, resolve)` before calling `onCaptchaRequired(base64)`.
3. Call `onCaptchaRequired(base64)` to emit image to operator UI; await promise.
4. Fill captcha input with operator text.
5. Click search button.
6. Race outcomes (15 s):
   - `table` visible → `'table'`
   - "Record not available" → `'no_record'`
   - "captcha did not match" text → `'captcha_err'`
   - Timeout → `'timeout'`
7. On `'captcha_err'` or `'timeout'`: if < 3 attempts, clear input and retry; at 3 attempts, throw.

### Table pass (collecting raw data)

Column indices are detected dynamically from `<th>` headers:

| Header pattern | Field | Fallback index |
|---|---|---|
| `/challan\s*no/i` | `challanNo` | 1 |
| `/violation\s*date/i` | `violationDate` | 2 |
| `/violation\s*loc/i` | `location` | 3 |
| `/status/i` | `status` | 7 |
| `/penalty\s*\(rs\)\|penalty\|amount/i` | `amount` | 8 |

For each row:
- Skip if < 5 cells or `challanNo` empty.
- Skip if status does not match `/pending/i`.
- Check presence of `a:has-text("Pay") / button:has-text("Pay")` in the row.
- Determine `challanType`:
  - `amount > 0` AND no Pay button → `OFFLINE`
  - Otherwise → `ONLINE`

### View-page pass (per pending challan)

1. Click `a:has-text("View") / button:has-text("View")` in the row.
2. Wait for `domcontentloaded` + 800 ms.
3. Extract Act & Section text via `extractActAndSection()` (2-strategy fallback — see §5).
4. If `amount === 0` and act/section found: look up amount in `offenceMap` (keyed by lowercase act/section text).
5. Apply PII masks + inline JS mask for challan number.
6. Screenshot full page (`fullPage: false`).
7. Remove masks.
8. Push result.
9. `page.goBack()` or re-navigate to `SITE_URL` on failure.

---

## 5. Field Mapping

| Output Field | Source | Notes |
|---|---|---|
| `noticeNo` | `cells[C.challanNo]` | Challan number |
| `vehicleNumber` | `registrationNumber.toUpperCase()` | From context |
| `offenceDate` | `cells[C.violationDate]` → `parseDate()` | `"31-05-2020 / 14:19"` → `"2020-05-31"` |
| `offenceDetail` | `extractActAndSection()` or `"Jharkhand Traffic Challan"` | Act & Section text from detail page |
| `offenceLocation` | `cells[C.location]` | Violation location |
| `penaltyAmount` | `cells[C.amount]` (or Excel lookup if 0) | `parseAmount()` strips `₹`, spaces, commas |
| `status` | Constant | Always `"Unpaid"` |
| `challanType` | Pay-button + amount logic | `OFFLINE` if amount > 0 and no Pay button; else `ONLINE` |
| `challanCourt` | Constant | `"Jharkhand Traffic Police Department"` |
| `imageBuffer` | Detail page full screenshot | PII-masked |

**Date parser:** `(\d{2})-(\d{2})-(\d{4})` matched → `"YYYY-MM-DD"`. Falls back to text before `/` if regex fails.

**Amount parser:** `/[₹\s,]/g` removed from raw string.

### Act & Section extraction (`extractActAndSection`)

**Strategy 1:** DOM traversal — find `td/th/div/span/p` containing `/act\s*[&and]*\s*section/i`, then:
- Sibling `td` in same `tr`
- Text of next `tr`
- Inline text after colon pattern

**Strategy 2:** Body text regex — match `\d+[\(\w\)]+\s*[\w\s\-()]+(?:light|signal|speed|helmet|belt|lane|document|insurance|permit|tax|license|licence|parking|drunk|dangerous)` (case-insensitive)

---

## 6. CAPTCHA Handling

### Image capture (`captureCaptchaImage`)

| Strategy | Description |
|---|---|
| 1 | Screenshot element matching `img[src*="captcha"], img[id*="captcha"], img[class*="captcha"], canvas[id*="captcha"], canvas[class*="captcha"]` |
| 2 | Find `input[placeholder*="aptcha"]` via `getBoundingClientRect()`, screenshot region 200 px to the left (width 220 px, height + 20 px) |
| 3 | Full-page screenshot (`fullPage: false`) as last resort |

### CAPTCHA input selector resolution

`page.evaluate()` finds `input[placeholder*="aptcha"] / input[placeholder*="APTCHA"] / input[id*="captcha"] / input[name*="captcha"]`. Returns `#id`, `input[name="..."]`, or falls back to `SEL_CAPTCHA_TEXT` (`input[placeholder*="aptcha"], ...`).

### CAPTCHA submit

`page.locator('button[type="submit"], input[type="submit"], .btn-primary, button:has-text("Search"), button:has-text("search")').first().click()`

### Attempt limit

`MAX_CAPTCHA_TRIES = 3`. On the 3rd failure throws:
`"Jharkhand CAPTCHA failed after 3 attempts. Please fetch challans manually from https://echallan.jhpolice.gov.in/payment/payonline"`

---

## 7. PII Masking Rules

Applied on the **detail page** before screenshot:

| Mechanism | Selector / Logic | What it hides |
|---|---|---|
| `applyPIIMasks()` | `td:has-text("Challan Number"), td:has-text("Challan No")` | Challan number label cells |
| `applyPIIMasks()` | `td:has-text("Vehicle No"), td:has-text("Registration No")` | Vehicle number label cells |
| Inline JS mask | All `td, span, div, p` elements whose `textContent` equals or contains the challan number | Challan number value cells (positioned black overlay) |

The inline JS mask creates `.__pii_mask__` `div` elements with `position:absolute` black overlays. They are removed after screenshot via `document.querySelectorAll('.__pii_mask__').forEach(el => el.remove())`.

---

## 8. Error Handling

| Condition | Behaviour |
|---|---|
| `'no_record'` outcome from CAPTCHA search | Returns `[]` |
| `'captcha_err'` on attempt < 3 | Clear input, wait 800 ms, retry |
| `'captcha_err'` on attempt 3 | Throws with manual URL message |
| CAPTCHA image cannot be captured | Throws `"[JH] Could not capture CAPTCHA image"` |
| No View button for a pending row | Row skipped with status message |
| `page.goBack()` fails | Re-navigates to `SITE_URL` |
| Row has < 5 cells | Row skipped |
| Column map detection fails | Falls back to hardcoded indices (see §5) |
| `extractActAndSection` throws | Returns `""` (offenceDetail falls back to constant) |
| `offenceMap.get()` returns nothing for amount=0 row | `finalAmount` stays `"0"` |

---

## 9. Files

| File | Role |
|---|---|
| `backend/src/worker/scrapers/jharkhand/index.js` | Full self-contained scraper — exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/utils/sessionStore.js` | `captchaResolvers` map used to bridge socket → promise |
| `backend/src/utils/maskPII.js` | `applyPIIMasks()` utility |
| `backend/src/utils/offenceMap.js` | `getOffenceMap()` — Excel-backed map of act/section → penalty amount |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 2 pending challans, CAPTCHA correct on first try | Array of 2 rows; both have View-page screenshots |
| Vehicle with no record | `'no_record'` outcome; returns `[]` |
| Vehicle with only Settled/Paid challans | All rows skipped; `rowData.length === 0`; returns `[]` |
| CAPTCHA wrong on attempt 1 and 2, correct on attempt 3 | Two retries; results returned on attempt 3 |
| CAPTCHA wrong on all 3 attempts | Throws with manual URL message |
| Challan with `amount = "0"` and act/section found in Excel | `penaltyAmount` updated from `offenceMap` |
| Challan with `amount > 0` and no Pay button | `challanType === "OFFLINE"` |
| Challan with Pay button | `challanType === "ONLINE"` |
| Raw date `"31-05-2020 / 14:19"` | `offenceDate === "2020-05-31"` |
| Raw amount `"₹ 2,000"` | `penaltyAmount === "2000"` |
| `page.goBack()` throws on return from View page | Re-navigates to `SITE_URL` silently |
| captureCaptchaImage strategy 1 fails | Falls back to strategy 2 (region screenshot), then strategy 3 (full page) |
