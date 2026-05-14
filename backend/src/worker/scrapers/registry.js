/**
 * Scraper registry.
 * To add a new site: import it here and push onto SCRAPERS.
 *
 * Each scraper module must export:
 *   id            — unique string key  e.g. 'delhi'
 *   label         — human-readable tab name  e.g. 'Delhi Traffic Police'
 *   CHALLAN_COURT — string used as challanCourt in the POST API
 *   requiresOtp   — boolean
 *   run(page, context, helpers) → ScrapedRow[]
 */
import * as delhi     from './delhi/index.js';
import * as surat     from './surat/index.js';
import * as rajkot    from './rajkot/index.js';
import * as vadodara  from './vadodara/index.js';
import * as mp        from './mp/index.js';
import * as telangana  from './telangana/index.js';
import * as jharkhand   from './jharkhand/index.js';
import * as westbengal  from './westbengal/index.js';
import * as kerala      from './kerala/index.js';

export const SCRAPERS = [delhi, surat, rajkot, vadodara, mp, telangana, jharkhand, westbengal, kerala];

/** Look up a scraper by its id string */
export function getScraperById(id) {
  return SCRAPERS.find(s => s.id === id) ?? null;
}
