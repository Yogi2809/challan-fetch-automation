/**
 * Telangana Police eChallan scraper
 * Site: https://echallan.tspolice.gov.in/publicview/
 *
 * CAPTCHA: image-rendered arithmetic — human-in-the-loop (same strategy as Jharkhand).
 *          The captcha image (#captchaDivtab1) is sent to the UI; operator types the answer.
 *          Max 3 attempts before giving up.
 *
 * Tab used: "Vehicle Number" (tab1) — inputs #REG_NO + #captchatab1, button #tab1btn.
 */
import { captchaResolvers }                  from '../../../utils/sessionStore.js';
import { applyPIIMasks, applyPIIMasksByText } from '../../../utils/maskPII.js';
import { solveCaptchaAuto }                   from '../../steps/solveCaptcha.js';

const SITE_URL          = 'https://echallan.tspolice.gov.in/publicview/';
const MAX_CAPTCHA_TRIES = 3;

export const id            = 'telangana';
export const label         = 'Telangana Police';
export const CHALLAN_COURT = 'Telangana Police Department';
export const requiresOtp     = false;
export const requiresCaptcha = true;

// ── Selectors (vehicle-number tab) ────────────────────────────────────────────
const SEL_VEHICLE_INPUT = '#REG_NO';
const SEL_CAPTCHA_IMG   = '#captchaDivtab1';
const SEL_ANSWER_INPUT  = '#captchatab1';
const SEL_GO_BTN        = '#tab1btn';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * "15-Nov-2025" → "2025-11-15"
 */
function parseDate(raw) {
  const months = {
    jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
    jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  };
  const m = (raw || '').match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (!m) return raw || '';
  const [, d, mon, y] = m;
  return `${y}-${months[mon.toLowerCase()] || '01'}-${d.padStart(2, '0')}`;
}

/**
 * Screenshot the captcha image and return a base64 string.
 * Falls back to a region screenshot if the element is not found.
 */
async function captureCaptchaImage(page, emitStatus) {
  // Primary: screenshot #captchaDivtab1 directly
  const buf = await page.locator(SEL_CAPTCHA_IMG).first().screenshot().catch(() => null);
  if (buf) {
    emitStatus('[TG] Captcha captured via #captchaDivtab1');
    return buf.toString('base64');
  }

  // Fallback: any img with alt="captcha"
  const altBuf = await page.locator('img[alt="captcha"]').first().screenshot().catch(() => null);
  if (altBuf) {
    emitStatus('[TG] Captcha captured via img[alt="captcha"]');
    return altBuf.toString('base64');
  }

  // Last resort: full visible page
  emitStatus('[TG] Captcha: falling back to full-page screenshot');
  const full = await page.screenshot({ fullPage: false }).catch(() => null);
  return full ? full.toString('base64') : null;
}

/**
 * Dismiss a SweetAlert or Bootstrap modal if visible.
 * Returns true if a modal was found and dismissed.
 */
async function dismissErrorModal(page, emitStatus) {
  // SweetAlert 1 (.sweet-alert), SweetAlert 2 (.swal2-popup), Bootstrap (.modal.show/.modal.in)
  const MODAL_SEL = '.sweet-alert.visible, .sweet-alert[style*="block"], ' +
                    '.swal2-popup.swal2-show, ' +
                    '.modal.in, .modal.show, .modal[style*="display: block"], .modal[style*="display:block"]';

  const count = await page.locator(MODAL_SEL).count().catch(() => 0);
  if (!count) return false;

  const text = await page.locator(MODAL_SEL).first().textContent().catch(() => '');
  emitStatus(`[TG] Error modal: "${text.replace(/\s+/g, ' ').trim().slice(0, 120)}"`);

  // Click the confirm/OK button
  await page.locator(
    '.sweet-alert button.confirm, .swal2-confirm, ' +
    '.modal.in button, .modal.show button, ' +
    'button:has-text("OK"), .confirm, input[value="OK"]'
  ).first().click({ force: true, timeout: 4000 }).catch(() => {});

  // Wait for modal to disappear
  await page.waitForFunction(
    () => !document.querySelector(
      '.sweet-alert.visible, .swal2-popup.swal2-show, ' +
      '.modal.in, .modal.show, .modal[style*="display: block"], .modal[style*="display:block"]'
    ),
    { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

// ── Main scraper ──────────────────────────────────────────────────────────────

export async function run(page, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { emitStatus, onCaptchaRequired } = helpers;

  emitStatus('Opening Telangana Police eChallan portal…');
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // Dismiss any pre-existing modal (feedback form, etc.) that may be open on load
  await dismissErrorModal(page, emitStatus).catch(() => {});

  // ── CAPTCHA: auto-solve (AI) with human fallback ─────────────────────────

  // Shared helpers (close over page / registrationNumber)
  const tgFillAndSubmit = async (value) => {
    await page.click(SEL_VEHICLE_INPUT).catch(() => {});
    await page.evaluate(sel => { const el = document.querySelector(sel); if (el) el.value = ''; }, SEL_VEHICLE_INPUT);
    await page.type(SEL_VEHICLE_INPUT, registrationNumber.toUpperCase(), { delay: 60 });
    await page.click(SEL_ANSWER_INPUT).catch(() => {});
    await page.fill(SEL_ANSWER_INPUT, value);
    await page.click(SEL_GO_BTN);
  };

  const tgCheckOutcome = async () => {
    const raw = await Promise.race([
      page.waitForFunction(() => document.body.innerText.includes('Echallan No'), { timeout: 15000 }).then(() => 'results'),
      page.waitForFunction(() => /no pending challan|no records found|vehicle not found/i.test(document.body.innerText), { timeout: 15000 }).then(() => 'no_record'),
      page.waitForFunction(() => !!document.querySelector('.sweet-alert.visible, .sweet-alert[style*="block"], .swal2-popup.swal2-show, .modal.in, .modal.show, .modal[style*="display: block"], .modal[style*="display:block"]'), { timeout: 15000 }).then(() => 'modal'),
      new Promise(resolve => page.once('dialog', async d => { emitStatus(`[TG] Native dialog: "${d.message()}"`); await d.dismiss().catch(() => d.accept().catch(() => {})); resolve('dialog'); })),
    ]).catch(() => 'timeout');

    emitStatus(`[TG] Search outcome: ${raw}`);
    if (raw === 'results')   return 'found';
    if (raw === 'no_record') return 'no_challans';

    const modalText = await page.evaluate(() => {
      const m = document.querySelector('.sweet-alert.visible, .sweet-alert[style*="block"], .swal2-popup.swal2-show, .modal.in, .modal.show');
      return m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
    }).catch(() => '');
    emitStatus(`[TG] Modal text: "${modalText.slice(0, 120)}"`);
    await dismissErrorModal(page, emitStatus);
    return 'wrong_captcha';
  };

  const tgOnWrongCaptcha = async () => {
    // Refresh captcha image for next attempt
    await page.evaluate(() => {
      const img = document.querySelector('#captchaDivtab1, img[alt="captcha"]');
      if (img) { const s = img.src.replace(/[?&]_t=\d+/, ''); img.src = s + (s.includes('?') ? '&' : '?') + '_t=' + Date.now(); }
    }).catch(() => {});
    await page.waitForSelector(SEL_VEHICLE_INPUT, { timeout: 8000 }).catch(() => {});
    await page.fill(SEL_ANSWER_INPUT, '').catch(() => {});
    await page.waitForTimeout(800);
  };

  const tgHumanFallback = async () => {
    let attempt = 0;
    while (attempt < MAX_CAPTCHA_TRIES) {
      attempt++;
      emitStatus(`[TG] Human CAPTCHA attempt ${attempt}/${MAX_CAPTCHA_TRIES}…`);
      const captchaBase64 = await captureCaptchaImage(page, emitStatus);
      if (!captchaBase64) throw new Error('[TG] Could not capture CAPTCHA image');
      const captchaPromise = new Promise(resolve => { captchaResolvers.set(sessionId, resolve); });
      await onCaptchaRequired(captchaBase64);
      emitStatus('[TG] CAPTCHA sent to UI — waiting for operator input…');
      const captchaText = await captchaPromise;
      captchaResolvers.delete(sessionId);
      await tgFillAndSubmit(captchaText.trim());
      const outcome = await tgCheckOutcome();
      if (outcome === 'found' || outcome === 'no_challans') return outcome;
      if (attempt >= MAX_CAPTCHA_TRIES) {
        throw new Error('Telangana CAPTCHA failed after 3 attempts. Please fetch challans manually from https://echallan.tspolice.gov.in/publicview/');
      }
      await tgOnWrongCaptcha();
    }
  };

  const solvedOutcome = await solveCaptchaAuto(sessionId, emitStatus, {
    captureBuffer: async () => {
      const buf = await page.locator(SEL_CAPTCHA_IMG).first().screenshot().catch(() => null);
      if (buf) { emitStatus('[TG] Captcha buffer captured via #captchaDivtab1'); return buf; }
      const altBuf = await page.locator('img[alt="captcha"]').first().screenshot().catch(() => null);
      if (altBuf) { emitStatus('[TG] Captcha buffer captured via img[alt="captcha"]'); return altBuf; }
      const full = await page.screenshot({ fullPage: false });
      if (!full) throw new Error('[TG] Could not capture CAPTCHA image');
      return full;
    },
    fillAndSubmit:  tgFillAndSubmit,
    checkOutcome:   tgCheckOutcome,
    onWrongCaptcha: tgOnWrongCaptcha,
    humanFallback:  tgHumanFallback,
  });

  const searchOutcome = solvedOutcome === 'found' ? 'results' : 'no_record';

  // ── Handle "Record not available" ─────────────────────────────────────────
  if (searchOutcome === 'no_record') {
    emitStatus('No pending challans found on Telangana Police portal.');
    return [];
  }

  // ── Scrape challan rows ────────────────────────────────────────────────────
  //
  // Confirmed DOM structure (from live inspection of TS08HV6071):
  // Each actual challan <tr> has exactly 13 DIRECT <td> children (:scope > td).
  //
  // Direct-child column indices (0-based):
  //  0  Sno ("1","2","3")
  //  1  Checkbox (empty)
  //  2  Unit Name ("Malkajgiri")
  //  3  Echallan No ("CYB06LG249332222")       → noticeNo
  //  4  Date ("18-Sep-2024")                    → offenceDate
  //  5  Time ("10:41")
  //  6  Place of Violation                      → offenceLocation
  //  7  PS Limits
  //  8  Violation+Amount nested table text      → violation (strip trailing digits)
  //  9  Fine Amount ("1000")
  // 10  User Charges ("35")
  // 11  Total Fine ("1035")                     → penaltyAmount  ← confirmed
  // 12  Image button cell

  const challanData = await page.evaluate(() => {
    const results = [];
    const allRows = Array.from(document.querySelectorAll('tr'));

    for (const tr of allRows) {
      const cells = Array.from(tr.querySelectorAll(':scope > td'))
        .map(td => td.textContent.trim());

      if (cells.length < 13) continue;
      if (!/^\d+$/.test(cells[0])) continue;
      if (!/^[A-Z]{2,}[0-9]/.test(cells[3])) continue;

      results.push({
        sno:          cells[0],
        echallanNo:   cells[3],
        date:         cells[4],
        place:        cells[6],
        violationRaw: cells[8],
        totalFine:    cells[11],
        cellCount:    cells.length,
      });
    }
    return results;
  });

  emitStatus(`[TG] Found ${challanData.length} challan row(s). Data: ${JSON.stringify(challanData)}`);

  if (challanData.length === 0) {
    emitStatus('No pending challans found on Telangana Police portal.');
    return [];
  }

  const results = [];

  for (let i = 0; i < challanData.length; i++) {
    const row = challanData[i];

    // Strip trailing number from combined "Violation+Amount" cell
    const violation = (row.violationRaw || '').replace(/\d[\d,]*\s*$/, '').trim()
      || row.violationRaw || 'Traffic Violation';

    emitStatus(`[TG] Row ${i + 1}: ${row.echallanNo} | ${violation} | ₹${row.totalFine} | ${row.date}`);

    // ── Click "Click For Image" → new tab → screenshot → close ──────────────
    let imageBuffer = null;
    try {
      const imgBtns = page.locator(
        'input[value*="Image"], input[value*="image"], button:has-text("Image"), a:has-text("Image")'
      );
      const btnCount = await imgBtns.count();
      emitStatus(`[TG] Image buttons found: ${btnCount}, clicking index ${i}`);

      if (i < btnCount) {
        const [newTab] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 12000 }),
          imgBtns.nth(i).click(),
        ]);
        await newTab.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await newTab.waitForTimeout(1500);
        imageBuffer = await newTab.screenshot({ fullPage: false });
        await newTab.close();
        emitStatus(`[TG] ✓ Image captured for challan ${i + 1}`);
      }
    } catch (e) {
      emitStatus(`[TG] Image capture failed for row ${i}: ${e.message} — using table screenshot as fallback`);
    }

    // Fallback: masked screenshot of the results table
    if (!imageBuffer) {
      const maskCleanup = await applyPIIMasks(page, [
        'tr td:nth-child(4)',
        SEL_VEHICLE_INPUT,
      ]).catch(async () => async () => {});
      const textCleanup = await applyPIIMasksByText(page, [
        registrationNumber.toUpperCase(),
        row.echallanNo,
      ]).catch(async () => async () => {});
      imageBuffer = await page.screenshot({ fullPage: false }).catch(() => null);
      await maskCleanup();
      await textCleanup();
    }

    results.push({
      noticeNo:        row.echallanNo,
      vehicleNumber:   registrationNumber.toUpperCase(),
      offenceDate:     parseDate(row.date),
      offenceDetail:   violation,
      offenceLocation: row.place,
      penaltyAmount:   row.totalFine,
      status:          'Unpaid',
      challanType:     'ONLINE',
      challanCourt:    CHALLAN_COURT,
      imageBuffer,
    });
  }

  return results;
}
