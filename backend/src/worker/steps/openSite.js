export const SEL_VEHICLE_INPUT = '#vehicle_number';
export const SEL_SEARCH_BTN    = '#submit1';

export async function openSite(page, registrationNumber, safeFind, sessionId) {
  await page.goto('https://traffic.delhipolice.gov.in/notice/pay-notice', {
    waitUntil: 'domcontentloaded',
  });
  await safeFind(page, SEL_VEHICLE_INPUT, { sessionId });
  await page.fill(SEL_VEHICLE_INPUT, registrationNumber);
  await safeFind(page, SEL_SEARCH_BTN, { sessionId });
  await page.click(SEL_SEARCH_BTN);
}
