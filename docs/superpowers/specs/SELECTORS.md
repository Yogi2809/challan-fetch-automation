# Delhi Traffic Police — Confirmed HTML Selectors

> Source: Screenshots extracted from FigJam file (2026-04-27).
> All selectors are **confirmed from real screenshots** of `traffic.delhipolice.gov.in`.
> Placeholder-text selectors are the most stable; prefer them over class/id selectors.

---

## 🌐 Entry URL

```
https://traffic.delhipolice.gov.in/notice/pay-notice
```

---

## Step 1 — PENDING NOTICES Search Page

| Element | Playwright Selector | Notes |
|---|---|---|
| Vehicle Number input | `#vehicle_number` | id confirmed via live DOM inspection |
| Notice Number input | `#notice_number` | Alternative search field — not used |
| Search Details button | `#submit1` | id confirmed via live DOM inspection |

---

## Step 2 — Change Mobile Number Modal

The modal appears **automatically** on every fresh session (first challan lookup).

| Element | Playwright Selector | Notes |
|---|---|---|
| Modal heading | `text=Change Mobile Number` | Confirms modal is open |
| New Mobile Number | `input[placeholder="Mobile number"] >> nth=0` | Has numeric spinner arrows |
| Confirm Mobile Number | `input[placeholder="Mobile number"] >> nth=1` | Plain text input |
| Chassis last-4 input | `input[type="password"] >> nth=0` | Shows `••••`; label above is partial chassis |
| Engine last-4 input | `input[type="password"] >> nth=1` | Shows `••••`; label above is partial engine |
| Submit button | `button:has-text("Submit")` | Green button |
| Cancel button | `button:has-text("Cancel")` | Red button |

> **Note**: The partial chassis/engine strings (e.g. `MALC181CLHM22`, `G4FGGW59:`) are shown as labels
> above each password field — they are read-only labels, not inputs.

---

## Step 3 — "Details Updated" Success Modal

Appears after successful mobile change submission.

| Element | Playwright Selector | Notes |
|---|---|---|
| Modal text | `text=Details Updated` | Confirms success |
| Sub-text | `text=Vehicle Details Verified` | Partial match OK |
| OK button | `button:has-text("OK")` | Blue button |

---

## Step 4 — OTP Modal

Appears after clicking OK on the Details Updated modal.

| Element | Playwright Selector | Notes |
|---|---|---|
| OTP input | `input[placeholder="Please Enter the OTP"]` | Single 6-digit input |
| Submit button | `button:has-text("Submit")` | Submits OTP |
| Change mobile Number link | `text=Change mobile Number` | Link below input |

---

## Step 5 — Challan Results Table

The table appears below the search form after OTP is verified.

### Table Container

```
table tbody tr
```

### Column Index Map (1-based `td:nth-child(N)`)

| Column | Index | Field Name | Notes |
|---|---|---|---|
| Notice No | 1 | `noticeNo` | Unique ID for dedup |
| Vehicle Number | 2 | `vehicleNumber` | Matches reg number |
| Offence Date & Time | 3 | `offenceDateRaw` | Format: `YYYY-MM-DD HH:MM:SS` — slice `[0,10]` for date |
| Offence Location | 4 | `offenceLocation` | Long text |
| Offence Detail | 5 | `offenceDetail` | Maps to `challanName` |
| View Image | 6 | — | Contains `<img>` or `<button>` to open offence image |
| Penalty Amount (Rs) | 7 | `penaltyAmount` | May be blank — use XLSX fallback |
| Status | 8 | `status` | e.g. "Sent to Virtual Court", "Pending for Payment" |
| Print Notice | 9 | — | Printer icon — skip |
| Make Payment | 10 | `makePayment` | "Virtual Court", "Pay Now", or blank → used for `challanType` |
| Verify Payment | 11 | — | Skip |
| Grievances | 12 | — | e.g. "Lodged" — skip |

### `challanType` Derivation

```javascript
// From Make Payment column text (column 10)
const mp = makePaymentText.trim().toLowerCase();
if (mp === 'virtual court' || mp === 'pay now') {
  challanType = 'ONLINE';
} else {
  challanType = 'OFFLINE';
}
```

### View Image Button

```javascript
// Inside each row, column 6
const viewImageBtn = row.locator('td:nth-child(6) img, td:nth-child(6) button, td:nth-child(6) a');
// Click to open offence image in new tab / modal
```

---

## Selector Quick-Reference (Copy-Paste)

```javascript
// ── Page ──────────────────────────────────────────────
const PAGE_URL = 'https://traffic.delhipolice.gov.in/notice/pay-notice';

// ── Step 1: Search ────────────────────────────────────
const SEL_VEHICLE_INPUT   = 'input[placeholder="PLEASE ENTER VEHICLE NUMBER"]';
const SEL_SEARCH_BTN      = 'button:has-text("Search Details")';

// ── Step 2: Change Mobile ─────────────────────────────
const SEL_MOBILE_MODAL    = 'text=Change Mobile Number';
const SEL_NEW_MOBILE      = 'input[placeholder="Mobile number"] >> nth=0';
const SEL_CONFIRM_MOBILE  = 'input[placeholder="Mobile number"] >> nth=1';
const SEL_CHASSIS_LAST4   = 'input[type="password"] >> nth=0';
const SEL_ENGINE_LAST4    = 'input[type="password"] >> nth=1';
const SEL_MOBILE_SUBMIT   = 'button:has-text("Submit")';

// ── Step 3: Details Updated ───────────────────────────
const SEL_DETAILS_OK      = 'button:has-text("OK")';

// ── Step 4: OTP ───────────────────────────────────────
const SEL_OTP_INPUT       = 'input[placeholder="Please Enter the OTP"]';
const SEL_OTP_SUBMIT      = 'button:has-text("Submit")';

// ── Step 5: Results Table ─────────────────────────────
const SEL_TABLE_ROWS      = 'table tbody tr';
const SEL_COL_NOTICE_NO   = 'td:nth-child(1)';
const SEL_COL_DATE_TIME   = 'td:nth-child(3)';
const SEL_COL_LOCATION    = 'td:nth-child(4)';
const SEL_COL_OFFENCE     = 'td:nth-child(5)';
const SEL_COL_VIEW_IMAGE  = 'td:nth-child(6)';
const SEL_COL_AMOUNT      = 'td:nth-child(7)';
const SEL_COL_STATUS      = 'td:nth-child(8)';
const SEL_COL_MAKE_PMT    = 'td:nth-child(10)';
```

---

## Notes

- The **Change Mobile modal always appears** on a fresh Playwright session — never skip it.
- The **chassis/engine fields are password-type** — use `.fill()`, not `.type()`, to avoid issues.
- The **OTP modal reuses the same "Submit" button text** as the mobile form — distinguish by waiting for `SEL_OTP_INPUT` to be visible first.
- The **results table may not appear** if no challans are found — always check `table tbody tr` count before iterating.
- `offenceDateRaw` from column 3 is in `YYYY-MM-DD HH:MM:SS` format — slice `[0, 10]` to get `YYYY-MM-DD`.
