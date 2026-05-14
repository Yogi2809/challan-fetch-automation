# Surat Traffic Force eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://suratcitypolice.org/
- **Scraper ID:** `surat`
- **Label:** Surat Traffic Force
- **Challan Court:** `Surat Traffic Police`

---

## 1. Overview

The Surat scraper fetches eChallan data from the Surat City Police public portal. No authentication, OTP, or CAPTCHA is required — it is a plain form POST followed by a table scrape. For each challan found the scraper clicks its row link to open a detail modal, takes a screenshot of the modal with PII masked, then closes it before moving to the next row.

**Authentication:** None
**CAPTCHA:** None
**requiresOtp:** `false`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate to home page | `https://suratcitypolice.org/` |
| 2 | Wait for vehicle number input | `input[name="vehicleno"]` |
| 3 | Fill registration number (uppercased) | `input[name="vehicleno"]` |
| 4 | Click Submit and wait for navigation | `input[type="submit"].get_btn` + `page.waitForNavigation` |
| 5 | Race: challan link or no-data alert | `a.btn-challan-no` vs `.alert-danger` (15 s each) |
| 6 | If challan links found, locate all table rows | `table[border="1"] tbody tr` |

**Form submit endpoint:** `https://suratcitypolice.org/home/getChallan/` (AJAX fills modal content after clicking a row link)

---

## 3. No-Challans Case

- **`.alert-danger` appears** (text: `"Challan data not available!"`) → returns `[]`
- **Race timeout** (neither selector appears within 15 s) → returns `[]`

Status message: `"No challans found on Surat Traffic Force: <alert text or 'No challan data available'>"`

---

## 4. Scraping Flow (main loop)

1. Collect all rows matching `table[border="1"] tbody tr`.
2. For each row:
   a. Read all `td` text contents (`cells[0..6]`).
   b. Skip rows with fewer than 6 cells.
   c. Read challan number from `a.btn-challan-no` text content; skip if empty.
   d. Read `data-href` attribute from `a.btn-challan-no` to extract the internal ID (last path segment after final `/`).
3. If `internalId` is present:
   - Click `a.btn-challan-no` in the row.
   - Wait for `#myModal .challan-info .card` to become visible (10 s).
   - Apply PII masks inside the modal (see §7).
   - Screenshot `#myModal .modal-dialog`.
   - Remove masks via `cleanup()`.
   - Click `[data-dismiss="modal"]` and wait for `#myModal` to be hidden (5 s).
4. If `internalId` is absent or modal flow throws: fall back to full-page screenshot (`fullPage: false`).
5. Push result row.

---

## 5. Field Mapping

| Output Field | Source | Notes |
|---|---|---|
| `noticeNo` | `a.btn-challan-no` text content | Same value as challan number |
| `vehicleNumber` | `registrationNumber.toUpperCase()` | From context |
| `offenceDate` | `cells[4]` → `parseDate()` | `"2018-11-22 12:33:17"` → `"2018-11-22"` (first 10 chars) |
| `offenceDetail` | `cells[5]` | Offence description |
| `offenceLocation` | `cells[6]` | Area name |
| `penaltyAmount` | `cells[2]` → `parseAmount()` | Strips `"Rs. "` prefix and `"/-"` suffix |
| `status` | `cells[3]` (whitespace-normalised) | e.g. `"Paid"`, `"Unpaid"` |
| `challanType` | Constant | Always `"ONLINE"` (Surat is a pure eChallan portal) |
| `challanCourt` | Constant | `"Surat Traffic Police"` |
| `imageBuffer` | Modal screenshot or full-page fallback | PII-masked |

**Amount parser:** `/Rs\.\s*/i` and `/-$/` removed from raw string.
**Date parser:** Raw string sliced at index 10.

---

## 6. CAPTCHA / OTP Handling

Not applicable — no CAPTCHA or OTP on this portal.

---

## 7. PII Masking Rules

Masks applied to the **modal** before screenshot:

| Selector | What it hides |
|---|---|
| `#myModal .btn-challan-no` | Challan number link |
| `#myModal [class*="challan-no"]` | Any other challan-number-class elements |
| `#myModal [class*="vehicle"]` | Vehicle number elements |
| `#myModal td:first-child` | First column cells (often the challan or sequence number) |

Applied via `applyPIIMasks()`; cleaned up via the returned `cleanup()` function after screenshot.

---

## 8. Error Handling

| Condition | Behaviour |
|---|---|
| `.alert-danger` visible after submit | Returns `[]` with status message |
| Race timeout (15 s) | Returns `[]` with status message |
| Row has < 6 cells | Row skipped (`continue`) |
| `a.btn-challan-no` text is empty | Row skipped |
| Modal never becomes visible (10 s) | Catches error; falls back to full-page screenshot |
| `[data-dismiss="modal"]` click or hide-wait fails | Silently caught via `.catch(() => {})` |

---

## 9. Files

| File | Role |
|---|---|
| `backend/src/worker/scrapers/surat/index.js` | Self-contained scraper — exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/utils/maskPII.js` | `applyPIIMasks()` used for modal masking |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 3 pending challans | Array of 3 rows; each has modal screenshot |
| Vehicle with no challans | `.alert-danger` race wins; returns `[]` |
| Portal slow / times out | Race timeout wins; returns `[]` |
| `data-href` absent on a row | Falls back to full-page screenshot for that row |
| Modal fails to load after click | `catch` triggers; full-page screenshot used |
| Raw amount `"Rs. 1000/-"` | `penaltyAmount === "1000"` |
| Raw date `"2021-03-15 09:00:00"` | `offenceDate === "2021-03-15"` |
