/**
 * Madhya Pradesh Police eChallan scraper
 * Site: https://echallan.mponline.gov.in/
 * Requires CAPTCHA solving (human-in-the-loop, shown in UI)
 */
import { solveCaptcha, solveCaptchaAuto } from '../../steps/solveCaptcha.js';
import { applyPIIMasks } from '../../../utils/maskPII.js';

const SITE_URL = 'https://echallan.mponline.gov.in/';

export const id            = 'mp';
export const label         = 'MP eChallan';
export const CHALLAN_COURT = 'Madhya Pradesh Police Department';
export const requiresOtp     = false;
export const requiresCaptcha = true;

// ── Selectors (confirmed from live DOM / Vue bundle) ─────────────
const SEL_VEHICLE_INPUT = '.vehicleno';
const SEL_CAPTCHA_IMG   = '.cap_img img';
const SEL_CAPTCHA_TEXT  = '.captcha_text';
const SEL_SEARCH_BTN    = '.reset_ec_btn';
const SEL_DETAIL_AREA   = '.detail_area';
const SEL_SWAL          = '.swal2-container';
const SEL_CHALLAN_ROW   = 'table.challan_table-Fee';
const SEL_CHECKBOX      = 'input[type="checkbox"][title="Click to pay"]';
const SEL_CHALLAN_ID    = 'a[target="_blank"]';           // link containing Challan_id text
const SEL_AMOUNT        = 'td[data-label="Offence Penalty:"]';

/**
 * Extract offence date from challan number.
 * Strips leading alpha prefix, reads first 6 or 8 digits:
 *   8 digits → YYYYMMDD  e.g. SPD20220812... → 2022-08-12
 *   6 digits → DDMMYY    e.g. ITMSUJN120422... → 2022-04-12
 */
function parseMPDate(challanNo) {
  const digits = challanNo.replace(/^[A-Za-z]+/, '').match(/^(\d{6,8})/)?.[1] ?? '';
  if (digits.length >= 8) {
    return `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
  }
  if (digits.length === 6) {
    // DDMMYY → YYYY-MM-DD
    const d = digits.slice(0,2), m = digits.slice(2,4), y = digits.slice(4,6);
    return `20${y}-${m}-${d}`;
  }
  return '';
}

/** "₹ 1000 /-" → "1000" */
function parseAmount(raw) {
  return (raw || '').replace(/[₹\s,/-]/g, '').trim();
}

export async function run(page, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { emitStatus, onCaptchaRequired } = helpers;

  emitStatus('Opening MP eChallan portal…');
  try {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    emitStatus('[MP] Site unreachable from this server (timeout/block) — skipping MP.');
    return [];
  }

  // Wait for Vue app to render the search form
  await page.waitForSelector(SEL_VEHICLE_INPUT, { timeout: 20000 });
  await page.fill(SEL_VEHICLE_INPUT, registrationNumber.toUpperCase());
  emitStatus(`Vehicle number entered — solving CAPTCHA…`);

  // CAPTCHA auto-solve (AI webhook) with human fallback
  const outcome = await solveCaptchaAuto(sessionId, emitStatus, {
    captureBuffer: async () => {
      await page.waitForSelector(SEL_CAPTCHA_IMG, { timeout: 15000 });
      await page.waitForFunction(
        () => { const img = document.querySelector('.cap_img img'); return img && img.src && !img.src.endsWith('/'); },
        { timeout: 10000 }
      ).catch(() => {});
      return page.locator(SEL_CAPTCHA_IMG).screenshot();
    },
    fillAndSubmit: async (value) => {
      await page.fill(SEL_CAPTCHA_TEXT, value);
      await page.click(SEL_SEARCH_BTN);
    },
    checkOutcome: async () => {
      const result = await Promise.race([
        page.waitForSelector(SEL_DETAIL_AREA, { timeout: 15000 }).then(() => 'found'),
        page.waitForSelector(SEL_SWAL,        { timeout: 15000 }).then(() => 'dialog'),
        page.waitForSelector('.sweet-alert',  { timeout: 15000 }).then(() => 'dialog'),
        page.waitForSelector('[role="dialog"]', { timeout: 15000 }).then(() => 'dialog'),
        page.waitForFunction(
          () => /no challan|no record|record not found|not found|no data|keep drive safely|no pending|no offence|no dues/i.test(document.body.innerText),
          { timeout: 15000 }
        ).then(() => 'no_challans_text'),
      ]).catch(() => 'timeout');

      if (result === 'found')          return 'found';
      if (result === 'no_challans_text') return 'no_challans';

      if (result === 'dialog') {
        const swalText = await page.locator('.swal2-container').innerText({ timeout: 3000 }).catch(() => '');
        if (/loading/i.test(swalText)) {
          await page.waitForSelector('.swal2-container', { state: 'hidden', timeout: 10000 }).catch(() => {});
          const r2 = await Promise.race([
            page.waitForSelector(SEL_DETAIL_AREA, { timeout: 10000 }).then(() => 'found'),
            page.waitForFunction(() => /no challan|no record|record not found|not found|no data|keep drive safely/i.test(document.body.innerText), { timeout: 10000 }).then(() => 'no_challans_text'),
          ]).catch(() => 'timeout');
          if (r2 === 'found') return 'found';
          if (r2 === 'no_challans_text') return 'no_challans';
        }
        const dialogText = await page.locator('.swal2-container').innerText({ timeout: 3000 }).catch(() => '');
        const cleanMsg   = dialogText.replace(/\s+/g, ' ').trim();
        emitStatus(`[MP] Site dialog: "${cleanMsg.slice(0, 300)}"`);
        await page.locator('.swal2-confirm').click({ timeout: 5000 }).catch(() => page.keyboard.press('Enter').catch(() => {}));
        await page.waitForTimeout(600);
        if (/no\s+challan|no\s+record|record\s+not\s+found|not\s+found|no\s+data|no\s+pending|keep\s+drive\s+safely|challan\s+not\s+found|vehicle\s+not\s+found|no\s+offence|no\s+dues/i.test(cleanMsg)) return 'no_challans';
        if (/captcha|invalid captcha|wrong captcha|captcha did not match|captcha mismatch|incorrect captcha/i.test(cleanMsg)) return 'wrong_captcha';
        emitStatus(`[MP] Unknown dialog (treating as no_challans): "${cleanMsg.slice(0, 200)}"`);
        return 'no_challans';
      }
      return 'wrong_captcha'; // timeout treated as retry
    },
    onWrongCaptcha: async () => {
      await page.waitForTimeout(800);
    },
    humanFallback: () => solveCaptcha(page, sessionId, onCaptchaRequired, emitStatus),
  });

  if (outcome === 'no_challans') {
    emitStatus('No challans found on MP eChallan portal.');
    return [];
  }

  // ── Results loaded — scrape each challan row ──────────────────
  const rowLocators = await page.locator(SEL_CHALLAN_ROW).all();
  emitStatus(`Found ${rowLocators.length} challan row(s) — scraping…`);

  const results = [];

  for (const row of rowLocators) {
    const challanNoEl = row.locator(SEL_CHALLAN_ID).first();
    const challanNo   = (await challanNoEl.textContent().catch(() => '')).trim();
    if (!challanNo) continue;

    const amountRaw = (await row.locator(SEL_AMOUNT).first().textContent().catch(() => '')).trim();
    const amount    = parseAmount(amountRaw);

    // ── Determine ONLINE / OFFLINE via checkbox ──────────────────
    let challanType = 'OFFLINE';
    const checkbox = row.locator(SEL_CHECKBOX).first();
    if (await checkbox.count() > 0) {
      if (!(await checkbox.isDisabled())) {
        await checkbox.click().catch(() => {});
        if (await checkbox.isChecked().catch(() => false)) {
          challanType = 'ONLINE';
          await checkbox.click().catch(() => {}); // restore unchecked state
        }
      }
    }

    // ── Screenshot the row with Challan Number masked ─────────────
    const cleanup = await applyPIIMasks(page, [
      // Mask challan number badge / link inside this row
      `table.challan_table-Fee a[target="_blank"]`,
    ]);
    const imageBuffer = await row.screenshot().catch(() => page.screenshot({ fullPage: false }));
    await cleanup();

    results.push({
      noticeNo:        challanNo,
      vehicleNumber:   registrationNumber.toUpperCase(),
      offenceDate:     parseMPDate(challanNo),
      offenceDetail:   'MP Challan Site',   // no offence type shown on portal
      offenceLocation: '',
      penaltyAmount:   amount,
      status:          'Unpaid',
      challanType,
      challanCourt:    CHALLAN_COURT,
      imageBuffer,
    });
  }

  return results;
}
