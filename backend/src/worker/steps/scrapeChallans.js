import { applyPIIMasks } from '../../utils/maskPII.js';

const SEL_TABLE_ROWS = 'table tbody tr';

// Columns 1 & 2 in the Delhi table contain Notice No and Vehicle Number
const DELHI_PII_SELECTORS = [
  'table tbody tr td:nth-child(1)',   // notice number
  'table tbody tr td:nth-child(2)',   // vehicle number
];

function deriveChallanType(makePaymentText) {
  const t = (makePaymentText || '').trim().toLowerCase();
  return (t === 'pay now' || t === 'virtual court') ? 'ONLINE' : 'OFFLINE';
}

function extractDate(rawDateTime) {
  return (rawDateTime || '').slice(0, 10);
}

export async function scrapeChallans(page, sessionId, safeFind, emitStatus) {
  // Race: either real table rows appear OR "No Record Found" indicator
  const raceResult = await Promise.race([
    page.waitForSelector(SEL_TABLE_ROWS,          { timeout: 30000 }).then(() => 'rows'),
    page.waitForSelector('text=No Record Found',  { timeout: 30000 }).then(() => 'no_record'),
  ]).catch(() => 'timeout');

  if (raceResult === 'no_record') {
    emitStatus('No pending notices found on Delhi Traffic Police for this vehicle.');
    return [];
  }
  if (raceResult === 'timeout') {
    emitStatus('Timed out waiting for challan results — returning empty.');
    return [];
  }

  const cleanupPageMask = await applyPIIMasks(page, DELHI_PII_SELECTORS);
  const pageScreenshotBuffer = await page.screenshot({ fullPage: true });
  await cleanupPageMask();
  const rows = await page.locator(SEL_TABLE_ROWS).all();
  emitStatus(`Found ${rows.length} challan row(s) — scraping…`);

  const results = [];

  for (const row of rows) {
    const cells = await row.locator('td').allTextContents();
    if (cells.length < 10) continue;

    const noticeNo        = cells[0]?.trim() || '';
    const vehicleNumber   = cells[1]?.trim() || '';
    const offenceDateRaw  = cells[2]?.trim() || '';
    const offenceLocation = cells[3]?.trim() || '';
    const offenceDetail   = cells[4]?.trim() || '';
    const penaltyAmount   = cells[6]?.trim() || '';
    const statusText      = cells[7]?.trim() || '';
    const makePayment     = cells[9]?.trim() || '';

    if (!noticeNo) continue;

    let imageBuffer = null;
    try {
      const imgBtn   = row.locator('td:nth-child(6) img, td:nth-child(6) button, td:nth-child(6) a');
      const imgCount = await imgBtn.count();
      if (imgCount > 0) {
        const [newPage] = await Promise.all([
          page.context().waitForEvent('page'),
          imgBtn.first().click(),
        ]);
        await newPage.waitForLoadState('domcontentloaded');
        imageBuffer = await newPage.screenshot();
        await newPage.close();
      }
    } catch (_) {}

    results.push({
      noticeNo,
      vehicleNumber,
      offenceDate:    extractDate(offenceDateRaw),
      offenceDetail,
      offenceLocation,
      penaltyAmount,
      status:         statusText,
      challanType:    deriveChallanType(makePayment),
      imageBuffer:    imageBuffer ?? pageScreenshotBuffer,
    });
  }

  return results;
}
