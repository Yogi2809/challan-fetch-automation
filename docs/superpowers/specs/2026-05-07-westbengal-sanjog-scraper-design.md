# West Bengal (SANJOG) eChallan Scraper — Design Spec

**Date:** 2026-05-07  
**Site:** https://sanjog.wb.gov.in/  
**Scraper ID:** `westbengal`  
**Label:** `West Bengal (SANJOG)`

---

## 1. Overview

Automate challan lookup on the SANJOG unified portal (Govt. of West Bengal). No CAPTCHA. Auth uses Vehicle Number + last-5 digits of Chassis Number. Multiple providers possible per vehicle (e.g. Kolkata Police, West Bengal Traffic Police). All providers are scraped; Challan Court = the provider name from the portal.

---

## 2. Entry Point & Navigation

1. Navigate to `https://sanjog.wb.gov.in/`
2. Click **"Pay Your Pending Challan"** button → lands on `/payFine`
3. Fill **Vehicle Number** input → `registrationNumber.toUpperCase()`
4. Fill **Chassis number (Last 5 Digits)** input → `chassisNumber.slice(-5)`
5. Click the 🔍 search button
6. Wait for results: either Summary + Provider Challan Details table, or "No data available in table"

---

## 3. No-Challans Case

If the Provider Challan Details table shows **"No data available in table"** (Total Count = 0), emit status and return `[]` immediately. Do not retry.

---

## 4. Outer Loop — Provider Challan Details Table

The table lists one row per provider. It has **Previous|Next** pagination.

For each page of the outer table:
- Read all provider rows: `providerName`, `totalCount`
- For each row: click the 👁️ eye button in the Details column
- After processing the popup (see Section 5), close popup and continue
- After all rows on page processed: click **Next** — if first-row content is unchanged, stop; otherwise continue

---

## 5. Inner Loop — Challan Details Popup

A modal appears titled **"Challan Details"** with columns:  
`Provider | Case Number | Fine Amount | Offence | Place | Case Type | Case Date | Image`

The popup also has **Previous|Next** pagination.

For each page of the popup table:
- For each data row:
  1. Read `caseNumber` (= `noticeNo`)
  2. Read `fineAmountRaw` — determines type and amount (see Section 6)
  3. Read `offence` (= `offenceDetail`)
  4. Read `place` (= `offenceLocation`)
  5. Read `caseDateRaw` → parse to `YYYY-MM-DD`
  6. Take masked screenshot of the popup (see Section 8)
  7. Push result row
- Click **Next** in popup — if first-row Case Number unchanged → stop inner loop

The **Image** button in the last column is ignored; the popup screenshot serves as proof.

---

## 6. Field Mapping

| Portal field | Output field | Transformation |
|---|---|---|
| Case Number | `noticeNo` | As-is |
| Fine Amount | `penaltyAmount` | Strip `.0` suffix; strip "Pending in court" text |
| Fine Amount text | `challanType` | Contains "Pending in court" → `OFFLINE`; otherwise → `ONLINE` |
| Offence | `offenceDetail` | As-is; used for Excel lookup if amount = 0 |
| Place | `offenceLocation` | As-is |
| Case Date | `offenceDate` | `"20-Mar-2026"` → `"2026-03-20"` |
| Provider (column) | `challanCourt` | Dynamic — exact text from Provider column |

**Amount fallback:** If `penaltyAmount` is `0` or empty after parsing, look up by `offenceDetail` in the offence Excel map (`getOffenceMap()`).

**`vehicleNumber`:** `registrationNumber.toUpperCase()`  
**`status`:** Always `"Unpaid"`

---

## 7. Context Change — `chassisNumber`

`automation.js` currently passes `chassisLast4` to scrapers. West Bengal needs last 5.  
**Fix:** Add `chassisNumber` (full) to the context object passed to `scraper.run()`. All existing scrapers already ignore unknown context fields. The WB scraper slices `.slice(-5)` itself.

This is additive — no existing scraper is affected.

---

## 8. PII Masking in Screenshots

**Mask (black rectangle overlay):**
- Case Number cells in popup table
- Vehicle Number wherever visible in popup

**Do NOT mask:**
- Owner/person name
- Offence description
- Place, date, provider

Uses existing `applyPIIMasks(page, selectors)` utility.

---

## 9. Error Handling

| Scenario | Behaviour |
|---|---|
| "No data available in table" | Return `[]`, emit "No challans found" |
| Popup doesn't open | Log warning, skip that provider row |
| Field missing from popup row | Use empty string, continue |
| Navigation failure | Throw — automation.js handles retry at job level |

---

## 10. Files Changed

| File | Change |
|---|---|
| `backend/src/worker/scrapers/westbengal/index.js` | **NEW** — full scraper |
| `backend/src/worker/scrapers/registry.js` | Add `westbengal` import + entry |
| `backend/src/worker/automation.js` | Add `chassisNumber` to context object (additive) |

---

## 11. Test Cases

| Vehicle No | Chassis last 5 | Expected |
|---|---|---|
| WB02AN5500 | 18344 (from WDD2131046L018344) | Challans found — Kolkata Police, ₹500, ONLINE |
| WB02AN5501 | 12345 | No challans — "No data available in table" |
