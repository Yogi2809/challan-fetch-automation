# Rajkot Traffic Police eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://rajkotcitypolice.co.in/
- **Scraper ID:** `rajkot`
- **Label:** Rajkot Traffic Police
- **Challan Court:** `Rajkot Traffic Police Department`

---

## 1. Overview

The Rajkot scraper fetches eChallan data from the Rajkot City Police public portal. It is a thin wrapper around the shared `scrapeGujaratPolice()` base function (also used by the Vadodara scraper). Both sites run an identical ASP.NET WebForms template, so all selector logic lives in the shared base.

No authentication, OTP, or CAPTCHA is required.

**Authentication:** None
**CAPTCHA:** None
**requiresOtp:** `false`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate to home page | `https://rajkotcitypolice.co.in/` |
| 2 | Wait for vehicle input (ASP.NET content placeholder) | `#ContentPlaceHolder1_txtVehicleNo` |
| 3 | Fill registration number (uppercased) | `#ContentPlaceHolder1_txtVehicleNo` |
| 4 | Click Submit and wait for navigation | `#ContentPlaceHolder1_btnSubmit` + `page.waitForNavigation` |
| 5 | Race: challan section list or no-records div | `section.challan-list` vs `#ContentPlaceHolder1_divEmpty` (15 s) |

---

## 3. No-Challans Case

- **`#ContentPlaceHolder1_divEmpty` appears** → returns `[]`
- **Race timeout** (neither selector within 15 s) → returns `[]`

Status message: `"No challans found on Rajkot Traffic Police Department."`

---

## 4. Scraping Flow (main loop)

All logic is in `scrapeGujaratPolice()` in `gujaratPoliceBase.js`:

1. Take a single screenshot of `#ContentPlaceHolder1_homepageblockright` (the results panel) after applying PII masks (see §7). One image is shared across all challan rows for this scraper.
2. Count `section.challan-list` elements — each section is one challan.
3. For each index `i` from `0` to `count - 1`:
   - Read fields using indexed ASP.NET repeater IDs (see §5).
   - Skip if `noticeNo` is empty.
   - Push result row using the shared panel screenshot.

---

## 5. Field Mapping

| Output Field | Selector (index `i`) | Notes |
|---|---|---|
| `noticeNo` | `#ContentPlaceHolder1_rptNotice_lblNoticeNo_${i}` | Notice number |
| `vehicleNumber` | `registrationNumber.toUpperCase()` | From context |
| `offenceDate` | `#ContentPlaceHolder1_rptNotice_lblNoticeDate_${i}` → `parseDate()` | `"29/11/2021"` → `"2021-11-29"` |
| `offenceDetail` | `#ContentPlaceHolder1_rptNotice_lblViolationType_${i}` | Violation type string |
| `offenceLocation` | `#ContentPlaceHolder1_rptNotice_lblPlace_${i}` | Location/place |
| `penaltyAmount` | `#ContentPlaceHolder1_rptNotice_lblAmount_${i}` | Raw amount string from site |
| `status` | Constant | Always `"Unpaid"` |
| `challanType` | Constant | Always `"ONLINE"` |
| `challanCourt` | Constant | `"Rajkot Traffic Police Department"` |
| `imageBuffer` | Panel screenshot | PII-masked before capture |

**Date parser:** `"DD/MM/YYYY"` split on `/` → reassembled as `"YYYY-MM-DD"`.

---

## 6. CAPTCHA / OTP Handling

Not applicable — no CAPTCHA or OTP on this portal.

---

## 7. PII Masking Rules

Applied to the results panel before the single screenshot is taken:

| Selector | What it hides |
|---|---|
| `#ContentPlaceHolder1_lblVehicleNo` | Registration number heading |
| `[id^="ContentPlaceHolder1_rptNotice_lblNoticeNo_"]` | All notice numbers in the repeater |

Masks applied via `applyPIIMasks()`; cleaned up via returned `cleanup()` function after screenshot.

---

## 8. Error Handling

| Condition | Behaviour |
|---|---|
| `#ContentPlaceHolder1_divEmpty` visible | Returns `[]` with status message |
| Race timeout (15 s) | Returns `[]` with status message |
| `noticeNo` is empty for a row | Row skipped (`continue`) |
| Panel screenshot fails | Falls back to full-page screenshot via `.catch()` |
| `safeFind()` cannot locate vehicle input | Throws session-aware error |

---

## 9. Files

| File | Role |
|---|---|
| `backend/src/worker/scrapers/rajkot/index.js` | Entry point — thin wrapper; exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/worker/scrapers/gujaratPoliceBase.js` | Shared base containing all selector logic, scraping loop, PII masking, and date parsing |
| `backend/src/utils/maskPII.js` | `applyPIIMasks()` utility |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 2 challans | Array of 2 rows; both share the same `imageBuffer` (panel screenshot) |
| Vehicle with no challans | `#ContentPlaceHolder1_divEmpty` race wins; returns `[]` |
| Race timeout | Returns `[]` |
| Raw date `"05/03/2022"` | `offenceDate === "2022-03-05"` |
| `noticeNo` empty on a row | Row silently skipped |
