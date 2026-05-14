# Telangana Police eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://echallan.tspolice.gov.in/publicview/
- **Scraper ID:** `telangana`
- **Label:** Telangana Police
- **Challan Court:** `Telangana Police Department`

---

## 1. Overview

The Telangana scraper fetches pending eChallan data from the Telangana State Police public portal. The site shows a **simple arithmetic image CAPTCHA** (e.g. `"6 - 4 = ?"`). Unlike the MP and Jharkhand scrapers, this CAPTCHA is **solved automatically** — the scraper implements 8 sequential strategies to extract the math expression from the page's DOM, network traffic, or JavaScript context, then computes the answer programmatically.

If all 8 strategies fail, the scraper throws an error and logs detailed debug information via `emitStatus`.

**Authentication:** None
**CAPTCHA:** Auto-solved arithmetic image CAPTCHA
**requiresOtp:** `false`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Set up network request/response interceptors for captcha URLs | `page.on('request', ...)` / `page.on('response', ...)` |
| 2 | Navigate to portal (`waitUntil: 'networkidle'`) | `https://echallan.tspolice.gov.in/publicview/` |
| 3 | Dynamically resolve vehicle input selector | See §2a |
| 4 | Dynamically resolve answer input selector | See §2a |
| 5 | Dynamically resolve GO button selector | See §2a |
| 6 | Enter CAPTCHA solve + submit loop | — |

### 2a. Dynamic selector resolution

The scraper resolves selectors at runtime rather than hard-coding them, with fallback chains:

**Vehicle input:** `#REG_NO` → first `input[type="text"]` / `input:not([type])` whose `name|id|placeholder|className` matches `/vehicle|regno|reg_no|veh/i` → first text input on page

**Answer input:** `#answer` → first input whose `name|id|placeholder|className` matches `/answer|captcha|cap/i`
Fallback selector string: `#answer, input[name="answer"], input[id="answer"], input[placeholder*="nswer"], input[placeholder*="ANSW"], input[placeholder*="Answer"], input[placeholder*="answer"]`

**GO button:** `#GO` → first `input[type="submit"]` / `button[type="submit"]` / `button` whose `value|innerText` matches `/^go$/i`
Fallback selector string: `input[value="GO"], button[id="GO"], #GO, input[type="submit"][value="GO"]`

---

## 3. No-Challans Case

Detected during the submit-outcome race after each CAPTCHA attempt:

- Selector `td:has-text("No Pending"), div:has-text("No Pending Challans"), td:has-text("No Challans")` matches → returns `[]`
- `page.waitForFunction(() => /no pending|no challans|challan not found/i.test(document.body.innerText))` matches → returns `[]`
- After the loop breaks (table found), a secondary check: `page.locator('text=No Pending Challans').count() > 0` → returns `[]`

Status message: `"No pending challans found on Telangana Police portal."`

---

## 4. Scraping Flow (main loop)

### CAPTCHA + Submit loop

1. On `attempt > 1`: reset `captchaUrl`, toggle captcha `<img>` src to force a fresh request, wait 700 ms.
2. Fill vehicle number character-by-character using `page.type()` with 80 ms delay (site blocks `fill()` / paste).
3. Call `solveMathCaptcha()` to compute the CAPTCHA answer (see §6).
4. Fill the answer input using `page.type()` with 50 ms delay.
5. Click the GO button.
6. Race outcomes (12 s timeout each):
   - `table tr td` visible → `'table'` → **break loop**
   - "No Pending" text → `'no_challans'` → return `[]`
   - body text matches → `'no_challans_text'` → return `[]`
   - `.modal, [role="dialog"], .ui-dialog, .alert` visible → `'dialog'` → wrong CAPTCHA; dismiss and retry
   - Timeout → retry

### Row scraping (after loop breaks)

1. Collect all `table tr` rows.
2. Filter to rows with at least 12 cells where `cells[2]` (eChallan No) starts with 2+ uppercase letters.
3. For each matching row:
   - Apply PII masks (see §7).
   - Screenshot the row element.
   - Remove masks.
   - Push result.

---

## 5. Field Mapping

Table column indices (0-based):

| Index | Column Name | Output Field |
|---|---|---|
| 0 | Sno | — (ignored) |
| 1 | Unit Name | — (ignored) |
| 2 | Echallan No | `noticeNo` |
| 3 | Date | `offenceDate` (parsed) |
| 4 | Time | — (ignored) |
| 5 | Place of Violation | `offenceLocation` |
| 6 | PS Limits | — (ignored) |
| 7 | Violation | `offenceDetail` |
| 8 | Fine Amt | — (ignored) |
| 9 | Fine Amount | — (ignored) |
| 10 | User Charges | — (ignored) |
| 11 | Total Fine | `penaltyAmount` |
| 12 | Image | — (ignored) |

| Output Field | Source | Notes |
|---|---|---|
| `noticeNo` | `cells[2]` | eChallan number |
| `vehicleNumber` | `registrationNumber.toUpperCase()` | From context |
| `offenceDate` | `cells[3]` → `parseDate()` | `"15-Nov-2025"` → `"2025-11-15"` |
| `offenceDetail` | `cells[7]` | Violation description |
| `offenceLocation` | `cells[5]` | Place of violation |
| `penaltyAmount` | `cells[11]` | Total fine (raw string) |
| `status` | Constant | Always `"Unpaid"` |
| `challanType` | Constant | Always `"ONLINE"` |
| `challanCourt` | Constant | `"Telangana Police Department"` |
| `imageBuffer` | Row screenshot | PII-masked |

**Date parser:** `"DD-Mon-YYYY"` or `"DD Mon YYYY"` → `"YYYY-MM-DD"` using a 3-letter month map.

---

## 6. CAPTCHA Handling

The CAPTCHA is a rendered image of a math expression (e.g. `"6 - 4 = ?"`). The scraper tries 8 strategies in order to extract the expression:

| # | Strategy | Description |
|---|---|---|
| 1 | Network-intercepted captcha URL | Parse query params of the captcha image URL captured before page load; look for expression in a single param, two numeric params + optional operator, or numbers in the URL path |
| 2 | Visible math text on page | `document.body.innerText.match(/\d+\s*[+\-×]\s*\d+/g)` |
| 3a | Hidden input with full expression | Any `input[type="hidden"]` whose `.value` matches the expression regex |
| 3b | Separate n1/n2 hidden inputs | Inputs matching `/num1\|n1\|first\|^a$\|val1\|v1\|no1/i` and `/num2\|n2\|second\|^b$\|val2\|v2\|no2/i` with optional operator input |
| 4 | Image URL params (DOM, post-load) | Inspect `src` and attributes of `img[src*="captcha"]`; parse URL params for numbers or expression |
| 5 | Window-level JS variables | `Object.keys(window)` matching `/captcha\|num\|answer\|question\|math\|cap\|op\|val\|expr/i`; evaluate expression or treat direct numeric value as answer |
| 6 | Inline `<script>` tags | Filter scripts mentioning captcha/num/answer; run `evalExpr()` on content |
| 7 | `data-*` attributes | Scan every DOM element's `data-*` and suspicious attributes; run `evalExpr()` on values |
| 8 | `localStorage` / `sessionStorage` | Stringify both stores; run `evalExpr()` on each value |

**Expression evaluator (`evalExpr`):** Matches `(\d+)\s*([+\-×xX*÷/])\s*(\d+)` and computes result. Handles `+`, `-`, `*`/`×`/`x`/`X` operators. Returns `null` if no match.

If all strategies are exhausted, throws: `"Could not read CAPTCHA expression — check [TG dbg] lines in Live Log for raw DOM state"`

---

## 7. PII Masking Rules

Applied per-row before screenshot:

| Selector | What it hides |
|---|---|
| `table tr td:nth-child(3)` | eChallan number column (all rows) |
| `table tr td[colspan]:first-child` | Vehicle number in the header row (if present) |

Applied via `applyPIIMasks()`; cleaned up via returned `cleanup()` function after screenshot.

---

## 8. Error Handling

| Condition | Behaviour |
|---|---|
| No-challans text found after submit | Returns `[]` |
| Wrong CAPTCHA (dialog appears) | Dismiss dialog, wait 800 ms, retry loop |
| Submit race timeout | Retry loop |
| All 8 CAPTCHA strategies exhausted | Throws with debug message |
| Vehicle input selector not found on page | Throws `"Could not find vehicle number input on Telangana page"` |
| Row has < 12 cells or `cells[2]` doesn't match | Row filtered out before loop |
| Row screenshot fails | Falls back to `page.screenshot({ fullPage: false })` via `.catch()` |

---

## 9. Files

| File | Role |
|---|---|
| `backend/src/worker/scrapers/telangana/index.js` | Full self-contained scraper — exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/utils/maskPII.js` | `applyPIIMasks()` utility |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 2 pending challans (strategy 1 resolves) | Array of 2 rows with correct fields |
| Vehicle with no challans ("No Pending Challans") | Returns `[]` |
| CAPTCHA resolved via strategy 2 (visible text) | `solveMathCaptcha` returns correct answer |
| CAPTCHA resolved via strategy 3b (n1/n2 hidden inputs) | Correct sum/difference computed |
| All 8 strategies fail | Throws with debug message referencing Live Log |
| Wrong CAPTCHA on first attempt, correct on second | Dialog dismissed; loop retries; table found on retry |
| Raw date `"15-Nov-2025"` | `offenceDate === "2025-11-15"` |
| Row with < 12 cells | Row skipped by filter |
| Row where `cells[2]` does not start with uppercase letters | Row skipped by filter |
