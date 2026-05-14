import { captchaResolvers }    from '../../utils/sessionStore.js';
import { solveCaptchaWithAI, SsoExpiredError } from '../../utils/captchaSolver.js';

const SEL_CAPTCHA_IMG  = '.cap_img img';
const SEL_CAPTCHA_TEXT = '.captcha_text';
const SEL_SEARCH_BTN   = '.reset_ec_btn';
const SEL_DETAIL_AREA  = '.detail_area';
const SEL_SWAL         = '.swal2-container';

/** Returns true if the dialog message indicates a captcha failure */
function isCaptchaError(text) {
  return /captcha|invalid captcha|wrong captcha|captcha did not match|captcha mismatch|incorrect captcha/i.test(text);
}

/** Returns true if the dialog message indicates no challans exist */
function isNoChallans(text) {
  return /no\s+challan|no\s+record|record\s+not\s+found|not\s+found|no\s+data|no\s+pending|keep\s+drive\s+safely|challan\s+not\s+found|vehicle\s+not\s+found|no\s+offence|no\s+dues/i.test(text);
}

/**
 * Handles the MP eChallan CAPTCHA loop.
 * Shows CAPTCHA image in the UI, waits for operator to type it,
 * submits the form, and retries if wrong.
 *
 * @param {import('playwright').Page} page
 * @param {string} sessionId
 * @param {Function} onCaptchaRequired  async (base64: string) => void — emits to socket + updates DB
 * @param {Function} emitStatus
 * @returns {Promise<'found'|'no_challans'>}
 */
export async function solveCaptcha(page, sessionId, onCaptchaRequired, emitStatus) {
  let attempt = 0;

  while (true) {
    attempt++;
    emitStatus(`Waiting for CAPTCHA image (attempt ${attempt})…`);

    // Wait for captcha image to be loaded (src set by Vue app on mount / refresh)
    await page.waitForSelector(SEL_CAPTCHA_IMG, { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.cap_img img');
        return img && img.src && !img.src.endsWith('/');
      },
      { timeout: 10000 }
    ).catch(() => {});

    // Screenshot just the captcha image element → base64
    const captchaBuffer = await page.locator(SEL_CAPTCHA_IMG).screenshot().catch(() => null);
    if (!captchaBuffer) throw new Error('Could not capture CAPTCHA image');
    const captchaBase64 = captchaBuffer.toString('base64');

    // Register resolver BEFORE emitting, so UI submit is never lost
    const captchaPromise = new Promise(resolve => {
      captchaResolvers.set(sessionId, resolve);
    });

    await onCaptchaRequired(captchaBase64);
    emitStatus('CAPTCHA sent to UI — waiting for operator input…');

    const captchaText = await captchaPromise;
    captchaResolvers.delete(sessionId);

    emitStatus('CAPTCHA received — submitting search…');
    await page.fill(SEL_CAPTCHA_TEXT, captchaText.trim());
    await page.click(SEL_SEARCH_BTN);

    // Wait for: results area OR any dialog OR "No Challan" text appearing anywhere on page
    const outcome = await Promise.race([
      page.waitForSelector(SEL_DETAIL_AREA, { timeout: 15000 }).then(() => 'found'),
      page.waitForSelector(SEL_SWAL,        { timeout: 15000 }).then(() => 'dialog'),
      page.waitForSelector('.sweet-alert',  { timeout: 15000 }).then(() => 'dialog'),
      page.waitForSelector('[role="dialog"]', { timeout: 15000 }).then(() => 'dialog'),
      page.waitForFunction(
        () => /no challan|no record|record not found|not found|no data|keep drive safely|no pending|no offence|no dues/i.test(document.body.innerText),
        { timeout: 15000 }
      ).then(() => 'no_challans_text'),
    ]).catch(() => 'timeout');

    if (outcome === 'found') return 'found';
    if (outcome === 'no_challans_text') return 'no_challans';

    if (outcome === 'dialog') {
      // The site first shows a "Loading..." swal that auto-closes — wait for it to go away
      // then wait for the real result dialog or detail_area
      const swalText = await page.locator('.swal2-container').innerText({ timeout: 3000 }).catch(() => '');
      if (/loading/i.test(swalText)) {
        emitStatus('MP site loading — waiting for result…');
        await page.waitForSelector('.swal2-container', { state: 'hidden', timeout: 10000 }).catch(() => {});

        const result = await Promise.race([
          page.waitForSelector(SEL_DETAIL_AREA, { timeout: 10000 }).then(() => 'found'),
          page.waitForSelector(SEL_SWAL,        { timeout: 10000 }).then(() => 'dialog2'),
          page.waitForFunction(
            () => /no challan|no record|record not found|not found|no data|keep drive safely/i.test(document.body.innerText),
            { timeout: 10000 }
          ).then(() => 'no_challans_text'),
        ]).catch(() => 'timeout2');

        if (result === 'found') return 'found';
        if (result === 'no_challans_text') return 'no_challans';
        if (result === 'timeout2') {
          emitStatus('Timed out after loading — retrying…');
          continue;
        }
        // result === 'dialog2' — fall through to read the real dialog below
      }

      // Read the real dialog text
      const dialogText = await page.locator('.swal2-container').innerText({ timeout: 3000 }).catch(() => '');
      const cleanMsg = dialogText.replace(/\s+/g, ' ').trim();
      emitStatus(`[MP] Site dialog: "${cleanMsg.slice(0, 300)}"`);

      // Dismiss
      await page.locator('.swal2-confirm').click({ timeout: 5000 }).catch(() => {
        page.keyboard.press('Enter').catch(() => {});
      });
      await page.waitForTimeout(600);

      if (isNoChallans(cleanMsg)) {
        emitStatus('[MP] No challans found.');
        return 'no_challans';
      }

      if (isCaptchaError(cleanMsg)) {
        emitStatus('[MP] Wrong CAPTCHA — retrying with new CAPTCHA…');
        await page.waitForTimeout(800);
        continue;
      }

      // Unknown dialog — not a captcha error, treat as no challans (safe default)
      emitStatus(`[MP] Unknown response (treating as no challans): "${cleanMsg.slice(0, 200)}"`);
      return 'no_challans';
    }

    throw new Error('Timed out waiting for MP eChallan search result');
  }
}

/**
 * Auto-solve CAPTCHA using the AI webhook, with up to 3 attempts.
 * Falls back to human-in-the-loop on exhaustion.
 *
 * @param {string} sessionId
 * @param {Function} emitStatus
 * @param {object} opts
 * @param {Function} opts.captureBuffer  async () => Buffer
 * @param {Function} opts.fillAndSubmit  async (value: string) => void
 * @param {Function} opts.checkOutcome   async () => 'found'|'wrong_captcha'|'no_challans'
 * @param {Function} opts.onWrongCaptcha async () => void  (reset/cleanup between attempts)
 * @param {Function} opts.humanFallback  async () => 'found'|'no_challans'
 * @returns {Promise<'found'|'no_challans'>}
 */
export async function solveCaptchaAuto(sessionId, emitStatus, {
  captureBuffer,
  fillAndSubmit,
  checkOutcome,
  onWrongCaptcha,
  humanFallback,
}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    emitStatus(`[AUTO] CAPTCHA auto-solve attempt ${attempt}/3…`);
    try {
      const buffer  = await captureBuffer();
      const value   = await solveCaptchaWithAI(buffer, sessionId);
      emitStatus(`[AUTO] AI solved CAPTCHA: "${value}"`);

      await fillAndSubmit(value);
      const outcome = await checkOutcome();

      if (outcome === 'found' || outcome === 'no_challans') return outcome;

      emitStatus(`[AUTO] Wrong CAPTCHA on attempt ${attempt}${attempt < 3 ? ' — retrying…' : ''}`);
      await onWrongCaptcha();
    } catch (err) {
      if (err instanceof SsoExpiredError) {
        emitStatus(`[SSO_EXPIRED] ${err.message}`);
        break; // no point retrying — credentials are broken for all attempts
      }
      emitStatus(`[AUTO] Auto-solve attempt ${attempt} error: ${err.message}`);
      if (attempt < 3) await onWrongCaptcha().catch(() => {});
    }
  }

  emitStatus('[AUTO] 3 auto-solve attempts exhausted — switching to manual CAPTCHA input…');
  return humanFallback();
}
