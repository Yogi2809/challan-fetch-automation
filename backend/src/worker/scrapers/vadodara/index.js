/**
 * Vadodara Traffic Police eChallan scraper
 * Site: https://vadodaraechallan.co.in/
 * No OTP required — plain form submission
 */
import { scrapeGujaratPolice } from '../gujaratPoliceBase.js';

const SITE_URL = 'https://vadodaraechallan.co.in/';

export const id            = 'vadodara';
export const label         = 'Vadodara Traffic Police';
export const CHALLAN_COURT = 'Vadodara Traffic Police Department';
export const requiresOtp   = false;


export async function run(page, context, helpers) {
  return scrapeGujaratPolice(page, SITE_URL, CHALLAN_COURT, context, helpers);
}
