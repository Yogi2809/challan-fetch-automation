/**
 * Delhi Traffic Police scraper
 * Site: https://traffic.delhipolice.gov.in/notice/pay-notice
 * Requires: mobileNumber, chassisLast4, engineLast4, OTP
 */
export const id           = 'delhi';
export const label        = 'Delhi Traffic Police';
import { openSite }      from '../../steps/openSite.js';
import { changeMobile }  from '../../steps/changeMobile.js';
import { submitOtp }     from '../../steps/submitOtp.js';
import { scrapeChallans } from '../../steps/scrapeChallans.js';

/** Delhi scraper always runs — any vehicle can have a Delhi challan */
export const requiresOtp = true;

export const CHALLAN_COURT = 'Delhi(Traffic Department)';

/**
 * @param {import('playwright').Page} page
 * @param {{ registrationNumber, mobileNumber, chassisLast4, engineLast4,
 *           sessionId, otpResolvers }} context
 * @param {{ safeFind, emitStatus, emitProgress, onOtpRequired }} helpers
 * @returns {Promise<import('../../steps/scrapeChallans.js').ScrapedRow[]>}
 */
export async function run(page, context, helpers) {
  const { registrationNumber, mobileNumber, chassisLast4, engineLast4,
          sessionId, otpResolvers } = context;
  const { safeFind, emitStatus, emitProgress, onOtpRequired } = helpers;

  await openSite(page, registrationNumber, safeFind, sessionId);
  emitStatus('Delhi Police site opened — changing mobile number…');
  emitProgress(25);

  try {
    await changeMobile(page, mobileNumber, chassisLast4, engineLast4, safeFind, sessionId);
  } catch (err) {
    if (err.noRecords) {
      emitStatus('No pending notices found for this vehicle on Delhi Traffic Police.');
      return [];
    }
    throw err;
  }
  emitStatus('Mobile updated — awaiting OTP…');
  emitProgress(40);

  // Let automation.js update DB state and emit socket event (with site label)
  await onOtpRequired(CHALLAN_COURT);

  await submitOtp(page, sessionId, otpResolvers, safeFind, emitStatus);
  emitProgress(55);

  return scrapeChallans(page, sessionId, safeFind, emitStatus);
}
