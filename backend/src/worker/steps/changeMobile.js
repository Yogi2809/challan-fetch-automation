// Confirmed selectors from live DOM inspection (2026-04-28)
const SEL_OTP_INPUT          = '#otp';
const SEL_CHANGE_MOBILE_LINK = 'a:has-text("Change mobile Number")';
const SEL_NEW_MOBILE         = '#number';
const SEL_CONFIRM_MOBILE     = '#confirm-number';
const SEL_CHASSIS_LAST4      = '#chasis';
const SEL_ENGINE_LAST4       = '#engine';
const SEL_SWAL_CONFIRM       = '.swal2-confirm';
const SEL_SEARCH_BTN         = '#submit1';

export async function changeMobile(page, mobileNumber, chassisLast4, engineLast4, safeFind, sessionId) {
  // Step 1: Wait for either the OTP modal OR "No Record Found" (vehicle has no pending notices)
  const raceResult = await Promise.race([
    page.waitForSelector(SEL_OTP_INPUT,          { timeout: 20000 }).then(() => 'otp'),
    page.waitForSelector('text=No Record Found', { timeout: 20000 }).then(() => 'no_record'),
  ]).catch(() => 'timeout');

  if (raceResult === 'no_record') {
    // Signal the caller to skip OTP + scraping and return empty
    const err = new Error('NO_RECORDS_FOUND');
    err.noRecords = true;
    throw err;
  }
  if (raceResult === 'timeout') {
    throw new Error('Timed out waiting for OTP page or results after Search Details');
  }
  // 'otp' — OTP input appeared, proceed normally
  await page.click(SEL_CHANGE_MOBILE_LINK);

  // Step 2: Fill Change Mobile form
  await safeFind(page, SEL_NEW_MOBILE, { sessionId, timeout: 15000 });
  await page.fill(SEL_NEW_MOBILE,     mobileNumber);
  await page.fill(SEL_CONFIRM_MOBILE, mobileNumber);
  await page.fill(SEL_CHASSIS_LAST4,  chassisLast4);
  await page.fill(SEL_ENGINE_LAST4,   engineLast4);
  await page.click(SEL_SWAL_CONFIRM);

  // Step 3: "Details Updated" modal → click OK
  await safeFind(page, SEL_SWAL_CONFIRM, { sessionId, timeout: 20000 });
  await page.click(SEL_SWAL_CONFIRM);

  // Step 4: Page returns to the search form — click Search Details again
  // so the OTP modal reappears with the new mobile number
  await safeFind(page, SEL_SEARCH_BTN, { sessionId, timeout: 15000 });
  await page.click(SEL_SEARCH_BTN);
}
