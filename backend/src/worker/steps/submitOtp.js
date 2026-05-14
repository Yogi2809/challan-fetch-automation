import { resendHandlers } from '../../utils/sessionStore.js';

// Confirmed selectors from live DOM inspection (2026-04-28)
const SEL_OTP_INPUT   = '#otp';               // id confirmed
const SEL_OTP_SUBMIT  = '.swal2-confirm';     // swal2 modal Submit button
const SEL_RESEND_LINK = 'a[onclick="resendOtp()"]';
const SEL_OTP_MSG     = '#otp_msg';

export async function submitOtp(page, sessionId, otpResolvers, safeFind, emitStatus) {
  // Register resolver FIRST — before safeFind — so OTP submitted from UI is never lost
  // even if QC submits OTP while page is still loading
  const otpPromise = new Promise((resolve) => {
    otpResolvers.set(sessionId, resolve);
  });

  // Register resend handler — calls Delhi Police's resendOtp() on page
  resendHandlers.set(sessionId, async () => {
    await page.click(SEL_RESEND_LINK);
    // Wait up to 5s for confirmation message then return it
    const msg = await page.locator(SEL_OTP_MSG).innerText({ timeout: 5000 }).catch(() => 'OTP resent');
    return msg.trim();
  });

  // Wait for OTP input to appear on Playwright page
  try {
    await safeFind(page, SEL_OTP_INPUT, { sessionId, timeout: 60000 });
  } catch (err) {
    otpResolvers.delete(sessionId);
    resendHandlers.delete(sessionId);
    throw err;
  }

  // Wait indefinitely for QC to enter OTP — no timeout
  const otp = await otpPromise;

  otpResolvers.delete(sessionId);
  resendHandlers.delete(sessionId);
  emitStatus('OTP received — submitting…');

  // OTP is always 6 digits
  await page.fill(SEL_OTP_INPUT, String(otp).trim().slice(0, 6));
  await page.click(SEL_OTP_SUBMIT);
}
