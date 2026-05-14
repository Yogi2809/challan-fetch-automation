# Vadodara Traffic Police eChallan Scraper — Design Spec

- **Date:** 2026-05-07
- **Site:** https://vadodaraechallan.co.in/
- **Scraper ID:** `vadodara`
- **Label:** Vadodara Traffic Police
- **Challan Court:** `Vadodara Traffic Police Department`

---

## 1. Overview

The Vadodara scraper fetches eChallan data from the Vadodara Traffic Police public portal. Like Rajkot, it is a thin wrapper around the shared `scrapeGujaratPolice()` base function. Both sites run an identical ASP.NET WebForms template with matching selectors and page structure.

No authentication, OTP, or CAPTCHA is required.

**Authentication:** None
**CAPTCHA:** None
**requiresOtp:** `false`

---

## 2. Entry Point & Navigation

| Step | Action | Selector / URL |
|------|--------|----------------|
| 1 | Navigate to home page | `https://vadodaraechallan.co.in/` |
| 2 | Wait for vehicle input (ASP.NET content placeholder) | `#ContentPlaceHolder1_txtVehicleNo` |
| 3 | Fill registration number (uppercased) | `#ContentPlaceHolder1_txtVehicleNo` |
| 4 | Click Submit and wait for navigation | `#ContentPlaceHolder1_btnSubmit` + `page.waitForNavigation` |
| 5 | Race: challan section list or no-records div | `section.challan-list` vs `#ContentPlaceHolder1_divEmpty` (15 s) |

---

## 3. No-Challans Case

- **`#ContentPlaceHolder1_divEmpty` appears** → returns `[]`
- **Race timeout** (neither selector within 15 s) → returns `[]`

Status message: `"No challans found on Vadodara Traffic Police Department."`

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
| `challanCourt` | Constant | `"Vadodara Traffic Police Department"` |
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
| `backend/src/worker/scrapers/vadodara/index.js` | Entry point — thin wrapper; exports `id`, `label`, `CHALLAN_COURT`, `requiresOtp`, `run()` |
| `backend/src/worker/scrapers/gujaratPoliceBase.js` | Shared base containing all selector logic, scraping loop, PII masking, and date parsing |
| `backend/src/utils/maskPII.js` | `applyPIIMasks()` utility |

---

## 10. Test Cases

| Scenario | Expected Result |
|---|---|
| Vehicle with 2 challans | Array of 2 rows; both share the same `imageBuffer` (panel screenshot) |
| Vehicle with no challans | `#ContentPlaceHolder1_divEmpty` race wins; returns `[]` |
| Race timeout | Returns `[]` |
| Raw date `"12/07/2023"` | `offenceDate === "2023-07-12"` |
| `noticeNo` empty on a row | Row silently skipped |

---

## Notes on Rajkot vs Vadodara

Both scrapers are functionally identical apart from the site URL and `CHALLAN_COURT` constant. The only difference is:

| Property | Rajkot | Vadodara |
|---|---|---|
| `id` | `rajkot` | `vadodara` |
| `label` | `Rajkot Traffic Police` | `Vadodara Traffic Police` |
| `CHALLAN_COURT` | `Rajkot Traffic Police Department` | `Vadodara Traffic Police Department` |
| `SITE_URL` | `https://rajkotcitypolice.co.in/` | `https://vadodaraechallan.co.in/` |

All selector, parsing, masking, and flow logic is shared in `gujaratPoliceBase.js`.
