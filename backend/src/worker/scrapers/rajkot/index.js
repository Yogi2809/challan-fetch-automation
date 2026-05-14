/**
 * Rajkot Traffic Police eChallan scraper
 * Site: https://rajkotcitypolice.co.in/
 * No OTP required — plain form submission
 */
import { scrapeGujaratPolice } from '../gujaratPoliceBase.js';

const SITE_URL = 'https://rajkotcitypolice.co.in/';

export const id            = 'rajkot';
export const label         = 'Rajkot Traffic Police';
export const CHALLAN_COURT = 'Rajkot Traffic Police Department';
export const requiresOtp   = false;


export async function run(page, context, helpers) {
  return scrapeGujaratPolice(page, SITE_URL, CHALLAN_COURT, context, helpers);
}
