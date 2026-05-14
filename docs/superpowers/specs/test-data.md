# Test Data Reference — Challan Fetch Automation

> ⚠️ **STAGING / TESTING ONLY**
> All API endpoints, API keys, and vehicle data in this file are for **testing and local development only**.
> These credentials point to the **staging environment** — never use them in production.
> Source: RC card photograph provided 2026-04-27.

---

## 🚗 Test Vehicle (From RC Card)

| Field | Value | Notes |
|---|---|---|
| **Registration No.** | `RJ14CV8337` | Enter on Delhi Police website |
| **Chassis No.** | `MA3ETDE1S00114822` | Full number |
| **Chassis Last 4** | `4822` | Used in mobile change verification |
| **Engine No.** | `K10BN-1730089` | Full number |
| **Engine Last 4** | `0089` | Used in mobile change verification |
| **Owner Name** | SADDAM HUSAIN | For reference only |
| **Father's Name** | JAHIDUL ISHALAM | For reference only |
| **Fuel Type** | PETROL | For reference only |
| **Reg. Date** | 08/04/2014 | For reference only |
| **Reg. Validity** | 07/04/2029 | For reference only |
| **State** | Rajasthan (RJ) | Note: test on Delhi Police site |

---

## 🌐 External APIs — Staging Endpoints

### 1. GET Appointment Details
```bash
curl --location 'https://oms-purchase-stage.qac24svc.dev/api/order/{{appointmentId}}' \
  --header 'x-api-key: PcLHVSx97orSVxWqIS0yExFwjVP29EY1'
```

**Config keys:**
```
OMS_BASE_URL  = https://oms-purchase-stage.qac24svc.dev
OMS_API_KEY   = PcLHVSx97orSVxWqIS0yExFwjVP29EY1
Endpoint      = GET /api/order/:appointmentId
```

**Response fields we use:**
```json
{
  "registrationNumber": "RJ14CV8337",
  "chassisNumber":      "MA3ETDE1S00114822",
  "engineNumber":       "K10BN-1730089"
}
```
> ⚠️ Actual field names in the response may differ — verify with a live call and update `services/omsService.js` mapper accordingly.

---

### 2. POST Create Challan
```bash
curl --location 'https://challan-service-stage.qac24svc.dev/api/customer-challan/create' \
  --header 'x-api-key: Y2hhbGxhbi1zZXJ2aWNlLXN0YWdl' \
  --form 'appointmentId="{{appointmentId}}"' \
  --form 'challanName="<offence description>"' \
  --form 'challanType="ONLINE"' \
  --form 'noticeNumber="<notice no from site>"' \
  --form 'amount="<penalty amount>"' \
  --form 'createdBy="<qc-email@cars24.com>"' \
  --form 'offenceDate="YYYY-MM-DD"' \
  --form 'challanCourt="<court name>"' \
  --form 'challanProof=@"/path/to/offence-image.jpg"'
```

**Config keys:**
```
CHALLAN_SERVICE_BASE_URL  = https://challan-service-stage.qac24svc.dev
CHALLAN_SERVICE_API_KEY   = Y2hhbGxhbi1zZXJ2aWNlLXN0YWdl
Endpoint                  = POST /api/customer-challan/create
Content-Type              = multipart/form-data
```

**Field mapping from scraped data:**
| Form Field | Source |
|---|---|
| `appointmentId` | From job context |
| `challanName` | `scrapedRow.offenceDetail` |
| `challanType` | Always `"ONLINE"` |
| `noticeNumber` | `scrapedRow.noticeNo` (dedup key) |
| `amount` | `scrapedRow.penaltyAmount` (or xlsx lookup result) |
| `createdBy` | Logged-in QC's email |
| `offenceDate` | `scrapedRow.offenceDate` |
| `challanCourt` | `scrapedRow.challanCourt` |
| `challanProof` | Downloaded image file (temp path before upload) |

---

### 3. GET Existing Challans (Deduplication Check)
```bash
curl --location 'https://oms-purchase-stage.qac24svc.dev/api/order/challan/detail/{{appointmentId}}' \
  --header 'x-api-key: PcLHVSx97orSVxWqIS0yExFwjVP29EY1'
```

**Config keys:**
```
OMS_BASE_URL  = https://oms-purchase-stage.qac24svc.dev
OMS_API_KEY   = PcLHVSx97orSVxWqIS0yExFwjVP29EY1
Endpoint      = GET /api/order/challan/detail/:appointmentId
```

**Deduplication logic:**
```javascript
const existing    = response.data;           // array of existing challans
const existingNos = new Set(existing.map(c => c.noticeNumber));
const newRows     = scrapedRows.filter(r => !existingNos.has(r.noticeNo));
// Only call POST Create Challan for rows in newRows
```

---

## 🧪 How to Run a Manual Test

1. Get a real staging `appointmentId` for the test vehicle `RJ14CV8337` from the OMS team
2. Set `TEST_APPOINTMENT_ID` in `.env.test`
3. Set `TEST_MOBILE_NUMBER` to the owner's mobile (needed for the police site)
4. Start the backend: `npm run dev` (with `PLAYWRIGHT_HEADLESS=false` to watch)
5. Open the Stepper UI at `http://localhost:3001`
6. Enter the `TEST_APPOINTMENT_ID` → verify vehicle details populate correctly
7. Enter `TEST_MOBILE_NUMBER` → watch Playwright open the browser
8. Enter the OTP when prompted
9. Verify scraped challans appear in results
10. Verify Admin Panel call was made (check network logs or MongoDB)

---

## 🔑 API Key Summary

> ⚠️ **STAGING KEYS — FOR TESTING ONLY. Never use in production.**

| Service | Environment | API Key | Env Var |
|---|---|---|---|
| OMS (Appointment + Challan GET) | **STAGING** | `PcLHVSx97orSVxWqIS0yExFwjVP29EY1` | `OMS_API_KEY` |
| Challan Service (POST Create) | **STAGING** | `Y2hhbGxhbi1zZXJ2aWNlLXN0YWdl` | `CHALLAN_SERVICE_API_KEY` |
| OMS (Production) | PRODUCTION | `— to be provided —` | `OMS_API_KEY` |
| Challan Service (Production) | PRODUCTION | `— to be provided —` | `CHALLAN_SERVICE_API_KEY` |

Production keys must **never** be stored in code or `.env` files. Use AWS Secrets Manager, HashiCorp Vault, or equivalent.

---

## 📎 Notes

- The `challanProof` image must be sent as a **multipart file**, not a URL. The backend needs to:
  1. Download the offence image from the police website (or from S3 temp path)
  2. Write it to a temp file (`/tmp/<sessionId>-<noticeNo>.jpg`)
  3. Attach it to the multipart POST
  4. Delete the temp file after successful POST
- The `Cookie` headers in the original curl samples are session cookies — **do NOT use them**. Use `x-api-key` header only. Cookies expire; the API key does not.
- `offenceDate` format must be `YYYY-MM-DD` — parse/format scraped date strings accordingly.
