import { applyPIIMasks } from '../../utils/maskPII.js';

/**
 * Shared scraper logic for Gujarat Police eChallan sites
 * (Rajkot: rajkotcitypolice.co.in, Vadodara: vadodaraechallan.co.in)
 *
 * Both run the identical ASP.NET WebForms template — same IDs, same structure.
 */

const SEL_VEHICLE_INPUT = '#ContentPlaceHolder1_txtVehicleNo';
const SEL_SUBMIT_BTN    = '#ContentPlaceHolder1_btnSubmit';
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
export async function scrapeGujaratPolice(page, siteUrl, challanCourt, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { safeFind, emitStatus } = helpers;

  emitStatus(`Opening ${siteUrl} …`);
  await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });

  await safeFind(page, SEL_VEHICLE_INPUT, { sessionId, timeout: 15000 });
  await page.fill(SEL_VEHICLE_INPUT, registrationNumber.toUpperCase());
  emitStatus(`Searching challans for ${registrationNumber}…`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.click(SEL_SUBMIT_BTN),
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
