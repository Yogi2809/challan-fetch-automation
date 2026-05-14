/**
 * Kerala Police eChallan scraper
 * Site: https://payment.keralapolice.gov.in/epayment.com
 *
 * No CAPTCHA. No OTP. High latency (~2 min response time).
 * This scraper is marked isManual = true so it runs on-demand.
 *
 * Vehicle number format required by the portal:
 *   KL05AY4448  →  KL-05-AY-4448
 *   KL16J3004   →  KL-16-J-3004
 *
 * Portal uses RichFaces / JSF:
 *   Input:   id="frmdata:regno"   (colon in id — use attribute selector)
 *   Button:  id="frmdata:ep"
 *   Results: id="frmd:pay:n"  (RichFaces ExtendedDataTable)
 *   Rows:    frmd:pay:tb tbody tr
 *   Cells:   div.extdt-cell-div span  (columns 0-5)
 *
 * Fixed column indices (0-based within extdt-cell-div spans per row):
 *   0 = Chargememo Id
 *   1 = Offence Date  (DD-MM-YYYY)
 *   2 = Amount
 *   3 = Location
 *   4 = Section Name
 *   5 = Offence Description
 *   6 = Checkbox (ONLINE/OFFLINE determined by disabled attribute)
 *
 * "No challans" detection:
 *   - Header contains "No: Challans: 0"
 *   - Or table body has no rows
 */
import { applyPIIMasks, applyPIIMasksByText } from '../../../utils/maskPII.js';
import { getOffenceMap }                      from '../../../utils/offenceMap.js';
import { normalizeVehicleId }                 from '../../../utils/vehicleMasking.js';

const SITE_URL = 'https://payment.keralapolice.gov.in/epayment.com';

// ── Module exports ─────────────────────────────────────────────────────────────
export const id            = 'kerala';
export const label         = 'Kerala Police';
export const CHALLAN_COURT = 'Kerala Police Department';
export const requiresOtp     = false;
export const requiresCaptcha = false;
export const isManual        = true;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format registration number for Kerala portal.
 * Standard: KL05AY4448 → KL-05-AY-4448
 *           KL16J3004  → KL-16-J-3004
 */
function formatForKeralaPortal(regNo) {
  const v = normalizeVehicleId(regNo);
  const m = v.match(/^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{1,5})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
  return v;
}

/** "21-05-2023" → "2023-05-21" */
function parseDate(raw) {
  if (!raw) return '';
  const m = String(raw).match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) return String(raw).trim();
  return raw;
}

/** "₹ 2,000" / "2000" → "2000"  |  "" → "0" */
function parseAmount(raw) {
  const cleaned = String(raw || '').replace(/[₹\s,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? '0' : String(Math.round(num));
}

// ── Main scraper ─────────────────────────────────────────────────────────────

export async function run(page, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { emitStatus } = helpers;
  const offenceMap = getOffenceMap();

  const formattedRegNo = formatForKeralaPortal(registrationNumber);
  emitStatus(`[KL] Opening Kerala Police eChallan portal… (vehicle: ${formattedRegNo})`);
  emitStatus('[KL] Note: Kerala portal may take up to 2 minutes — please wait…');

  await page.goto(SITE_URL, {
    waitUntil: 'domcontentloaded',
    timeout:   60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // ── Fill vehicle number input (JSF id contains colon — use attribute selector) ──
  const inputLocator = page.locator('[id="frmdata:regno"]');
  const inputCount = await inputLocator.count().catch(() => 0);
  if (inputCount === 0) {
    throw new Error('[KL] Could not find vehicle number input (frmdata:regno) on Kerala portal');
  }

  await inputLocator.fill(formattedRegNo);
  emitStatus(`[KL] Entered vehicle number: ${formattedRegNo}`);

  // ── Click Search button ───────────────────────────────────────────────────
  const searchLocator = page.locator('[id="frmdata:ep"]');
  const btnCount = await searchLocator.count().catch(() => 0);
  if (btnCount === 0) {
    throw new Error('[KL] Could not find search button (frmdata:ep) on Kerala portal');
  }

  emitStatus('[KL] Submitting search — waiting for response (may take up to 2 minutes)…');

  // Full form POST — noWaitAfter so click() doesn't apply its own 30s timeout
  // to the post-click navigation; we handle navigation explicitly below.
  await searchLocator.click({ timeout: 30_000, noWaitAfter: true });
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 150_000 }).catch(() => {});

  await page.waitForLoadState('networkidle', { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // ── Check for invalid vehicle number ─────────────────────────────────────
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  emitStatus(`[KL] Page response (300 chars): ${bodyText.replace(/\s+/g, ' ').slice(0, 300)}`);

  if (/please\s+enter\s+a\s+valid\s+vehicle|invalid\s+vehicle|vehicle\s+not\s+found/i.test(bodyText)) {
    emitStatus('[KL] Invalid vehicle number — no challans found.');
    return [];
  }

  // ── Read header to determine challan count ────────────────────────────────
  // Header format: "Vehicle Number:KL-16-J-3004, Owner Name: ..., No: Challans: 1, Total Amount: 1500"
  const headerText = await page.evaluate(() => {
    // Header is inside the RichFaces table header section
    const selectors = [
      '[id="frmd:pay:header"]',
      '[id="frmd:pay"] .rich-table-header',
      '.rich-table-header',
      'table thead',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.innerText || el.textContent || '';
    }
    // Fallback: search for the "No: Challans" text anywhere on the page
    return document.body.innerText || '';
  }).catch(() => '');

  emitStatus(`[KL] Header text (200 chars): ${headerText.replace(/\s+/g, ' ').slice(0, 200)}`);

  const noChallansMatch = headerText.match(/No:\s*Challans:\s*(\d+)/i);
  if (noChallansMatch && noChallansMatch[1] === '0') {
    emitStatus('[KL] No pending challans found on Kerala Police portal.');
    return [];
  }

  if (/no\s+pending\s+charg[eo]?memo|no\s+challan|record\s+not\s+available/i.test(bodyText)) {
    emitStatus('[KL] No pending challans found on Kerala Police portal.');
    return [];
  }

  // ── Wait for the RichFaces results table ──────────────────────────────────
  // Table id = "frmd:pay:n"  (colon chars — use attribute selector)
  // Kerala portal can take 3-4 min to respond — wait up to 5 min
  emitStatus('[KL] Waiting for challan table to appear (up to 5 min)…');
  await page.waitForFunction(
    () => document.querySelector('[id="frmd:pay:n"] tbody tr') !== null,
    { timeout: 300_000 }
  ).catch(() => {});

  const tableRowCount = await page.locator('[id="frmd:pay:n"] tbody tr').count().catch(() => 0);
  if (tableRowCount === 0) {
    emitStatus('[KL] No challan rows found in results table.');
    return [];
  }

  emitStatus(`[KL] Found ${tableRowCount} row(s) in results table.`);

  // ── Extract rows ──────────────────────────────────────────────────────────
  // Each cell content is wrapped in: <div class="extdt-cell-div"><span>VALUE</span></div>
  // Fixed column indices (0-based):
  //   0=Chargememo Id, 1=Offence Date, 2=Amount, 3=Location, 4=Sec.Name, 5=Offence Desc
  // Column 6 = checkbox (ONLINE/OFFLINE)

  const allRows = await page.locator('[id="frmd:pay:n"] tbody tr').all();
  const results = [];

  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const row = allRows[rowIdx];

    // Read all cell text values from extdt-cell-div spans
    const cellTexts = await row.locator('div.extdt-cell-div span').allTextContents().catch(() => []);
    if (cellTexts.length < 3) continue;

    const challanId  = (cellTexts[0] || '').trim();
    const dateRaw    = (cellTexts[1] || '').trim();
    const amountRaw  = (cellTexts[2] || '').trim();
    const offenceRaw = (cellTexts[5] || cellTexts[4] || '').trim(); // prefer col 5, fallback to 4

    if (!challanId) continue;

    // ── Determine ONLINE / OFFLINE via checkbox disabled property ────────────
    let challanType = 'ONLINE';
    try {
      const cbCount = await row.locator('input[type="checkbox"]').count();
      if (cbCount > 0) {
        const isDisabled = await row.locator('input[type="checkbox"]').first()
          .evaluate(el => el.disabled);
        challanType = isDisabled ? 'OFFLINE' : 'ONLINE';
      }
    } catch {
      challanType = 'ONLINE';
    }

    // ── Parse amount; fall back to Excel if 0 ───────────────────────────────
    const amount    = parseAmount(amountRaw);
    const amountNum = parseInt(amount, 10) || 0;

    let finalAmount = amount;
    if (amountNum === 0 && offenceRaw) {
      const looked = offenceMap.get(offenceRaw.toLowerCase().trim());
      if (looked) {
        finalAmount = String(looked);
        emitStatus(`[KL] Amount from Excel for "${offenceRaw}": ${finalAmount}`);
      }
    }

    // ── PII masking before screenshot ────────────────────────────────────────
    const cleanupCss = await applyPIIMasks(page, [
      '[id="frmdata:regno"]',
    ]).catch(async () => async () => {});

    const cleanupText = await applyPIIMasksByText(page, [
      challanId,
      formattedRegNo,
      registrationNumber.toUpperCase(),
    ].filter(Boolean)).catch(async () => async () => {});

    const imageBuffer = await page.screenshot({ fullPage: false }).catch(
      () => page.screenshot({ fullPage: false })
    );

    await cleanupCss();
    await cleanupText();

    results.push({
      noticeNo:        challanId,
      vehicleNumber:   registrationNumber.toUpperCase(),
      offenceDate:     parseDate(dateRaw),
      offenceDetail:   offenceRaw || 'Kerala Traffic Challan',
      offenceLocation: (cellTexts[3] || '').trim(),
      penaltyAmount:   finalAmount,
      status:          'Unpaid',
      challanType,
      challanCourt:    CHALLAN_COURT,
      imageBuffer,
    });

    emitStatus(`[KL] ✓ ${challanId} | ${offenceRaw} | ₹${finalAmount} | ${challanType}`);
  }

  emitStatus(`[KL] Total challans collected: ${results.length}`);
  return results;
}
