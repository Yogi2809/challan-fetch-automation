import { applyPIIMasks } from '../../utils/maskPII.js';

/**
 * Shared scraper logic for Gujarat Police eChallan sites
 * (Rajkot: rajkotcitypolice.co.in, Vadodara: vadodaraechallan.co.in)
 *
 * Both run the identical ASP.NET WebForms template — same IDs, same structure.
 */

const SEL_VEHICLE_INPUT_CANDIDATES = [
  '#ContentPlaceHolder1_txtVehicleNo',
  'input[id*="txtVehicleNo"]',
  'input[id*="VehicleNo"]',
  'input[name*="VehicleNo"]',
  'input[placeholder*="Vehicle"]',
  'input[placeholder*="vehicle"]',
  'input[placeholder*="Number"]',
  'input[type="text"]:visible',
];
const SEL_SUBMIT_BTN_CANDIDATES = [
  '#ContentPlaceHolder1_btnSubmit',
  'input[id*="btnSubmit"]',
  'input[type="submit"]',
  'button[type="submit"]',
  'button:has-text("Submit")',
  'button:has-text("Search")',
];
const SEL_CHALLAN_LIST  = 'section.challan-list';
const SEL_NO_RECORDS    = '#ContentPlaceHolder1_divEmpty';
const SEL_RESULT_PANEL  = '#ContentPlaceHolder1_homepageblockright';

/**
 * "29/11/2021" → "2021-11-29"
 */
function parseDate(raw) {
  const [d, m, y] = (raw || '').trim().split('/');
  if (y && m && d) return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return raw || '';
}

/**
 * @param {import('playwright').Page} page
 * @param {string} siteUrl
 * @param {string} challanCourt
 * @param {{ registrationNumber, sessionId }} context
 * @param {{ safeFind, emitStatus }} helpers
 * @returns {Promise<ScrapedRow[]>}
 */
async function findSelector(page, candidates, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of candidates) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) return sel;
      } catch (_) {}
    }
    await page.waitForTimeout(300);
  }
  return null;
}

export async function scrapeGujaratPolice(page, siteUrl, challanCourt, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { safeFind, emitStatus } = helpers;

  emitStatus(`Opening ${siteUrl} …`);
  await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  const vehicleSel = await findSelector(page, SEL_VEHICLE_INPUT_CANDIDATES, 15000);
  if (!vehicleSel) throw new Error(`[Gujarat] Vehicle input not found on ${siteUrl} — site may have changed`);
  emitStatus(`[Gujarat] Found vehicle input: ${vehicleSel}`);

  const submitSel = await findSelector(page, SEL_SUBMIT_BTN_CANDIDATES, 5000);
  if (!submitSel) throw new Error(`[Gujarat] Submit button not found on ${siteUrl}`);

  await page.fill(vehicleSel, registrationNumber.toUpperCase());
  emitStatus(`Searching challans for ${registrationNumber}…`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.click(submitSel),
  ]);

  // Race: challan sections appear  OR  "No Records Found!" div appears
  const raceResult = await Promise.race([
    page.waitForSelector(SEL_CHALLAN_LIST, { timeout: 15000 }).then(() => 'found'),
    page.waitForSelector(SEL_NO_RECORDS,   { timeout: 15000 }).then(() => 'no_records'),
  ]).catch(() => 'timeout');

  if (raceResult === 'no_records' || raceResult === 'timeout') {
    emitStatus(`No challans found on ${challanCourt}.`);
    return [];
  }

  // Screenshot of right panel — mask vehicle reg number and notice numbers first
  const panelLocator = page.locator(SEL_RESULT_PANEL);
  const cleanup = await applyPIIMasks(page, [
    '#ContentPlaceHolder1_lblVehicleNo',                        // registration number heading
    '[id^="ContentPlaceHolder1_rptNotice_lblNoticeNo_"]',       // notice numbers in each row
  ]);
  const imageBuffer = await panelLocator.screenshot().catch(() => page.screenshot({ fullPage: false }));
  await cleanup();

  const count = await page.locator(SEL_CHALLAN_LIST).count();
  emitStatus(`Found ${count} challan(s) on ${challanCourt} — scraping…`);

  const results = [];

  for (let i = 0; i < count; i++) {
    const noticeNo      = (await page.locator(`#ContentPlaceHolder1_rptNotice_lblNoticeNo_${i}`).textContent()).trim();
    const dateRaw       = (await page.locator(`#ContentPlaceHolder1_rptNotice_lblNoticeDate_${i}`).textContent()).trim();
    const amount        = (await page.locator(`#ContentPlaceHolder1_rptNotice_lblAmount_${i}`).textContent()).trim();
    const violationType = (await page.locator(`#ContentPlaceHolder1_rptNotice_lblViolationType_${i}`).textContent()).trim();
    const place         = (await page.locator(`#ContentPlaceHolder1_rptNotice_lblPlace_${i}`).textContent()).trim();

    if (!noticeNo) continue;

    results.push({
      noticeNo,
      vehicleNumber:   registrationNumber.toUpperCase(),
      offenceDate:     parseDate(dateRaw),
      offenceDetail:   violationType,
      offenceLocation: place,
      penaltyAmount:   amount,
      status:          'Unpaid',
      challanType:     'ONLINE',
      challanCourt,
      imageBuffer,
    });
  }

  return results;
}
