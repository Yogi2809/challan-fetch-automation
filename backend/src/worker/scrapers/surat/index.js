/**
 * Surat Traffic Force eChallan scraper
 * Site: https://suratcitypolice.org/
 * No OTP required — plain form submission + table scrape
 */
import { applyPIIMasks } from '../../../utils/maskPII.js';

const SITE_URL    = 'https://suratcitypolice.org/';
const CHALLAN_URL = 'https://suratcitypolice.org/home/getChallan/';

export const id           = 'surat';
export const label        = 'Surat Traffic Force';
export const CHALLAN_COURT = 'Surat Traffic Police';
export const requiresOtp  = false;


/**
 * Parse "Rs. 1000/-" → "1000"
 */
function parseAmount(raw) {
  return (raw || '').replace(/Rs\.\s*/i, '').replace(/\/-$/, '').trim();
}

/**
 * "2018-11-22 12:33:17" → "2018-11-22"
 */
function parseDate(raw) {
  return (raw || '').slice(0, 10);
}

/**
 * @param {import('playwright').Page} page
 * @param {{ registrationNumber, sessionId }} context
 * @param {{ safeFind, emitStatus }} helpers
 * @returns {Promise<ScrapedRow[]>}
 */
export async function run(page, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { safeFind, emitStatus } = helpers;

  // ── Step 1: Open site and fill search form ──────────────────────
  emitStatus('Opening Surat Traffic Force eChallan portal…');
  try {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    emitStatus('[Surat] Site unreachable from this server (timeout/block) — skipping Surat.');
    return [];
  }

  await safeFind(page, 'input[name="vehicleno"]', { sessionId, timeout: 15000 });
  await page.fill('input[name="vehicleno"]', registrationNumber.toUpperCase());
  emitStatus(`Searching challans for ${registrationNumber}…`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.click('input[type="submit"].get_btn'),
  ]);

  // ── Step 2: Check for "no results" or wait for challan table ──
  const SEL_CHALLAN_LINK = 'a.btn-challan-no';
  const SEL_TABLE_ROW    = 'table[border="1"] tbody tr';
  const SEL_NO_DATA      = '.alert-danger';           // "Challan data not available!"

  // Race: either the challan links appear OR the "no data" alert appears
  const raceResult = await Promise.race([
    page.waitForSelector(SEL_CHALLAN_LINK, { timeout: 15000 }).then(() => 'found'),
    page.waitForSelector(SEL_NO_DATA,      { timeout: 15000 }).then(() => 'no_data'),
  ]).catch(() => 'timeout');

  if (raceResult === 'no_data' || raceResult === 'timeout') {
    const alertText = await page.locator(SEL_NO_DATA).innerText().catch(() => '');
    const reason    = alertText.trim() || 'No challan data available';
    emitStatus(`No challans found on Surat Traffic Force: ${reason}`);
    return [];
  }

  const rows = await page.locator(SEL_TABLE_ROW).all();
  emitStatus(`Found ${rows.length} challan row(s) on Surat portal — scraping…`);

  const results = [];

  for (const row of rows) {
    const cells = await row.locator('td').allTextContents();
    // cells: [0]=SR, [1]=ChallanNo, [2]=Amount, [3]=Status, [4]=Date, [5]=Offence, [6]=Area
    if (cells.length < 6) continue;

    const challanNo  = (await row.locator('a.btn-challan-no').textContent().catch(() => '')).trim();
    if (!challanNo) continue;

    const amount     = parseAmount(cells[2]?.trim() || '');
    const status     = (cells[3]?.trim() || '').replace(/\s+/g, ' ');
    const offenceDate = parseDate(cells[4]?.trim() || '');
    const offenceDetail = cells[5]?.trim() || '';
    const area       = cells[6]?.trim() || '';

    // Get the internal ID from data-href (used for getChallan AJAX call)
    const dataHref   = await row.locator('a.btn-challan-no').getAttribute('data-href').catch(() => '');
    const internalId = dataHref ? dataHref.split('/').pop() : '';

    // ── Step 3: Click challan link → screenshot modal ──────────
    let imageBuffer = null;
    if (internalId) {
      try {
        await row.locator('a.btn-challan-no').click();
        // Wait for modal content to populate (AJAX fills .challan-info)
        await page.waitForSelector('#myModal .challan-info .card', {
          state: 'visible',
          timeout: 10000,
        });

        // Mask PII inside the modal before screenshot
        const cleanupModal = await applyPIIMasks(page, [
          '#myModal .btn-challan-no',
          '#myModal [class*="challan-no"]',
          '#myModal [class*="vehicle"]',
          '#myModal td:first-child',
        ]);
        imageBuffer = await page.locator('#myModal .modal-dialog').screenshot();
        await cleanupModal();

        // Close modal before next iteration
        await page.click('[data-dismiss="modal"]');
        await page.waitForSelector('#myModal', { state: 'hidden', timeout: 5000 }).catch(() => {});
      } catch (err) {
        // Fall back to full-page screenshot if modal flow fails
        imageBuffer = await page.screenshot({ fullPage: false });
      }
    } else {
      imageBuffer = await page.screenshot({ fullPage: false });
    }

    results.push({
      noticeNo:        challanNo,       // noticeNumber == challanNo for Surat
      vehicleNumber:   registrationNumber.toUpperCase(),
      offenceDate,
      offenceDetail,
      offenceLocation: area,
      penaltyAmount:   amount,
      status,
      challanType:     'ONLINE',        // Surat is a pure eChallan portal
      imageBuffer,
    });
  }

  return results;
}
