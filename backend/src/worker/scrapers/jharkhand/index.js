/**
 * Jharkhand Traffic Police eChallan scraper
 * Site: https://echallan.jhpolice.gov.in/payment/payonline
 *
 * CAPTCHA: alphanumeric image captcha — human-in-the-loop (shown in UI)
 *          Max 3 attempts before giving up.
 *
 * Scraping order per Pending challan (avoids repeat form submission):
 *  1. Collect ALL table row data in one pass (Challan No, Amount, Date, Pay button presence, Status)
 *  2. For each Pending row: click View → extract Act & Section + screenshot → go back
 *
 * Status handling:
 *  - "Pending"  → scrape
 *  - "Settled"  → skip
 *  - "Paid"     → skip
 *
 * ONLINE / OFFLINE:
 *  - Pay button present + amount > 0  → ONLINE
 *  - Pay button absent  + amount = 0  → ONLINE  (amount from Excel lookup)
 *  - Pay button absent  + amount > 0  → OFFLINE
 */
import { captchaResolvers }                  from '../../../utils/sessionStore.js';
import { applyPIIMasks, applyPIIMasksByText } from '../../../utils/maskPII.js';
import { getOffenceMap }                      from '../../../utils/offenceMap.js';
import { solveCaptchaAuto }                   from '../../steps/solveCaptcha.js';

const SITE_URL           = 'https://echallan.jhpolice.gov.in/payment/payonline';
const MAX_CAPTCHA_TRIES  = 3;

export const id            = 'jharkhand';
export const label         = 'Jharkhand Traffic Police';
export const CHALLAN_COURT = 'Jharkhand Traffic Police Department';
export const requiresOtp     = false;
export const requiresCaptcha = true;

// ── Selectors ────────────────────────────────────────────────────────────────
const SEL_VEH_RADIO    = 'input[type="radio"]:first-of-type';  // "Vehicle registration no." radio
const SEL_VEH_INPUT    = 'input[placeholder*="JH"], input[placeholder*="EX-JH"], input[type="text"]';
const SEL_CAPTCHA_IMG  = 'img[src*="captcha"], img[id*="captcha"], img[class*="captcha"], canvas[id*="captcha"], canvas[class*="captcha"]';
const SEL_CAPTCHA_TEXT = 'input[placeholder*="aptcha"], input[placeholder*="APTCHA"], input[id*="captcha"]';
const SEL_SEARCH_BTN   = 'button[type="submit"], input[type="submit"], button.btn-primary, .btn-primary';
const SEL_TABLE        = 'table';
const SEL_RECORD_NA    = '*:has-text("Record not available"), *:has-text("record not available"), *:has-text("No record")';
const SEL_CAPTCHA_ERR  = '*:has-text("captcha did not match"), *:has-text("Captcha did not match")';
const SEL_VIEW_BTN     = 'a:has-text("View"), button:has-text("View")';
const SEL_ACT_SECTION  = 'td:has-text("Act"), th:has-text("Act")';   // detect header; sibling/following has value

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "31-05-2020 / 14:19" → "2020-05-31" */
function parseDate(raw) {
  const m = (raw || '').match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return raw?.split('/')[0]?.trim() || '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "2000" / "₹ 2,000" → "2000" */
function parseAmount(raw) {
  return (raw || '').replace(/[₹\s,]/g, '').trim();
}

/** Screenshot the CAPTCHA area and return base64 string */
async function captureCaptchaImage(page, emitStatus) {
  // 1. Try known image/canvas selectors
  for (const sel of [SEL_CAPTCHA_IMG]) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) {
      const buf = await page.locator(sel).first().screenshot().catch(() => null);
      if (buf) { emitStatus('[JH] Captcha captured via img/canvas selector'); return buf.toString('base64'); }
    }
  }

  // 2. Find captcha input then screenshot its neighbour (the captcha text/image element)
  const captchaInputBB = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="aptcha"], input[placeholder*="APTCHA"]');
    if (!inp) return null;
    const r = inp.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });

  if (captchaInputBB) {
    // Screenshot the region to the LEFT of the captcha input (where captcha image sits)
    const { x, y, h } = captchaInputBB;
    const clip = {
      x:      Math.max(0, x - 200),
      y:      Math.max(0, y - 10),
      width:  220,
      height: h + 20,
    };
    const buf = await page.screenshot({ clip }).catch(() => null);
    if (buf) { emitStatus('[JH] Captcha captured via region screenshot'); return buf.toString('base64'); }
  }

  // 3. Fall back: screenshot full visible area
  emitStatus('[JH] Captcha: falling back to full-page screenshot');
  const buf = await page.screenshot({ fullPage: false }).catch(() => null);
  return buf ? buf.toString('base64') : null;
}

/**
 * Extract the "Act & Section" offence text from the View detail page.
 * The page looks like a challan receipt with a two-column table.
 */
async function extractActAndSection(page, emitStatus) {
  try {
    // Strategy 1: look for a cell/td after the "Act & Section" header
    const actText = await page.evaluate(() => {
      // Find element containing "Act & Section" then get next sibling or following text
      const allCells = Array.from(document.querySelectorAll('td, th, div, span, p'));
      const header = allCells.find(el => /act\s*[&and]*\s*section/i.test(el.textContent || ''));
      if (!header) return null;

      // Try next sibling td
      const parent = header.closest('tr');
      if (parent) {
        const sibs = Array.from(parent.querySelectorAll('td'));
        const idx  = sibs.indexOf(header);
        if (sibs[idx + 1]) return sibs[idx + 1].textContent.trim();
      }

      // Try next row
      const nextRow = header.closest('tr')?.nextElementSibling;
      if (nextRow) {
        const text = nextRow.textContent.trim();
        if (text) return text;
      }

      // Try the element itself — maybe it has text like "Act & Section: 184(iv)(A)..."
      const fullText = header.textContent.trim();
      const m = fullText.match(/Act\s*[&and]*\s*Section\s*:?\s*(.+)/i);
      if (m) return m[1].trim();

      return null;
    });

    if (actText) {
      emitStatus(`[JH] Act & Section: ${actText.slice(0, 100)}`);
      return actText;
    }

    // Strategy 2: look for text containing law section number pattern (e.g. "184(iv)(A)")
    const bodyText = await page.evaluate(() => document.body.innerText);
    const matches  = bodyText.match(/\d+[\(\w\)]+\s*[\w\s\-()]+(?:light|signal|speed|helmet|belt|lane|document|insurance|permit|tax|license|licence|parking|drunk|dangerous)/gi);
    if (matches && matches.length > 0) {
      emitStatus(`[JH] Act & Section (body match): ${matches[0].slice(0, 100)}`);
      return matches[0].trim();
    }

    emitStatus('[JH] Could not extract Act & Section');
    return '';
  } catch (e) {
    emitStatus(`[JH] Act & Section error: ${e.message}`);
    return '';
  }
}

// ── Main scraper ─────────────────────────────────────────────────────────────

export async function run(page, context, helpers) {
  const { registrationNumber, sessionId } = context;
  const { emitStatus, onCaptchaRequired } = helpers;
  const offenceMap = getOffenceMap();

  emitStatus('Opening Jharkhand eChallan portal…');
  try {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    emitStatus('[JH] Site unreachable from this server (timeout/block) — skipping Jharkhand.');
    return [];
  }
  await page.waitForLoadState('networkidle').catch(() => {});

  // ── Ensure "Vehicle registration no." radio is selected ──────────────────
  const radios = await page.locator('input[type="radio"]').all();
  if (radios.length > 0) {
    // First radio = "Vehicle registration no."
    await radios[0].click().catch(() => {});
    emitStatus('[JH] Selected Vehicle registration no. radio');
  }

  // ── Fill registration number ──────────────────────────────────────────────
  // The input has placeholder "EX-JHXXAZXXXX"
  const vehicleInputSel = await page.evaluate(() => {
    const inp = Array.from(document.querySelectorAll('input[type="text"]'))
      .find(i => /JH|EX-JH|vehicle|registration/i.test(i.placeholder + i.id + i.name + i.className));
    if (!inp) return null;
    if (inp.id)   return `#${CSS.escape(inp.id)}`;
    if (inp.name) return `input[name="${inp.name}"]`;
    return 'input[type="text"]:first-of-type';
  });
  const finalVehicleSel = vehicleInputSel || 'input[type="text"]:first-of-type';
  await page.fill(finalVehicleSel, registrationNumber.toUpperCase());
  emitStatus(`[JH] Entered registration number`);

  // ── CAPTCHA: auto-solve (AI) with human fallback ─────────────────────────
  //
  // IMPORTANT: "Record not available" is the DEFAULT state of this portal on
  // initial page load. The checkOutcome fn only runs AFTER a search navigation,
  // so there is no false-positive risk.

  // Shared helpers (close over page / registrationNumber / finalVehicleSel)
  const jhFillAndSubmit = async (value) => {
    const captchaInputSel = await page.evaluate(() => {
      const inp = document.querySelector('input[placeholder*="aptcha"], input[placeholder*="APTCHA"], input[id*="captcha"], input[name*="captcha"]');
      if (!inp) return null;
      if (inp.id)   return `#${CSS.escape(inp.id)}`;
      if (inp.name) return `input[name="${inp.name}"]`;
      return null;
    });
    await page.fill(captchaInputSel || SEL_CAPTCHA_TEXT, value);
    emitStatus('[JH] Clicking search button…');
    await Promise.all([
      page.locator(
        'button[type="submit"], input[type="submit"], .btn-primary, ' +
        'button:has-text("Search"), button:has-text("search")'
      ).first().click(),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  };

  const jhCheckOutcome = async () => {
    const postText  = await page.evaluate(() => document.body.innerText).catch(() => '');
    const tableRows = await page.locator('table tbody tr, table tr:not(:first-child)').count().catch(() => 0);
    emitStatus(`[JH] Post-search body (200 chars): ${postText.replace(/\s+/g, ' ').slice(0, 200)}`);
    if (/captcha did not match|captcha\s+incorrect|wrong\s+captcha/i.test(postText)) return 'wrong_captcha';
    if (tableRows > 0)                                                                 return 'found';
    if (/record not available|no record|no\s+data/i.test(postText))                  return 'no_challans';
    return 'wrong_captcha'; // unknown — treat as retry
  };

  const jhOnWrongCaptcha = async () => {
    emitStatus('[JH] Reloading page for fresh captcha…');
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    const r = await page.locator('input[type="radio"]').all();
    if (r.length > 0) await r[0].click().catch(() => {});
    await page.fill(finalVehicleSel, registrationNumber.toUpperCase()).catch(() => {});
  };

  const jhHumanFallback = async () => {
    let attempt = 0;
    while (attempt < MAX_CAPTCHA_TRIES) {
      attempt++;
      emitStatus(`[JH] Human CAPTCHA attempt ${attempt}/${MAX_CAPTCHA_TRIES}…`);
      const captchaBase64 = await captureCaptchaImage(page, emitStatus);
      if (!captchaBase64) throw new Error('[JH] Could not capture CAPTCHA image');
      const captchaPromise = new Promise(resolve => { captchaResolvers.set(sessionId, resolve); });
      await onCaptchaRequired(captchaBase64);
      emitStatus('[JH] CAPTCHA sent to UI — waiting for operator input…');
      const captchaText = await captchaPromise;
      captchaResolvers.delete(sessionId);
      await jhFillAndSubmit(captchaText.trim());
      const outcome = await jhCheckOutcome();
      if (outcome === 'found' || outcome === 'no_challans') return outcome;
      if (attempt >= MAX_CAPTCHA_TRIES) {
        throw new Error('Jharkhand CAPTCHA failed after 3 attempts. Please fetch challans manually from https://echallan.jhpolice.gov.in/payment/payonline');
      }
      await jhOnWrongCaptcha();
    }
  };

  const solvedOutcome = await solveCaptchaAuto(sessionId, emitStatus, {
    captureBuffer: async () => {
      for (const sel of [SEL_CAPTCHA_IMG]) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          const buf = await page.locator(sel).first().screenshot().catch(() => null);
          if (buf) { emitStatus('[JH] Captcha buffer captured'); return buf; }
        }
      }
      const bb = await page.evaluate(() => {
        const inp = document.querySelector('input[placeholder*="aptcha"], input[placeholder*="APTCHA"]');
        if (!inp) return null;
        const r = inp.getBoundingClientRect();
        return { x: r.left, y: r.top, h: r.height };
      });
      if (bb) {
        const buf = await page.screenshot({ clip: { x: Math.max(0, bb.x - 200), y: Math.max(0, bb.y - 10), width: 220, height: bb.h + 20 } }).catch(() => null);
        if (buf) return buf;
      }
      const buf = await page.screenshot({ fullPage: false });
      if (!buf) throw new Error('[JH] Could not capture CAPTCHA image');
      return buf;
    },
    fillAndSubmit:  jhFillAndSubmit,
    checkOutcome:   jhCheckOutcome,
    onWrongCaptcha: jhOnWrongCaptcha,
    humanFallback:  jhHumanFallback,
  });

  const searchOutcome = solvedOutcome === 'found' ? 'table' : 'no_record';

  // ── Handle "Record not available" ────────────────────────────────────────
  if (searchOutcome === 'no_record') {
    emitStatus('No challan record found on Jharkhand Traffic Police portal.');
    return [];
  }

  // ── Parse table rows ─────────────────────────────────────────────────────
  // Columns: Sl.No | Challan No. | Violation Date/Time | Violation Location |
  //          Penalty Person | Vehicle Regt. No. | DL Number | Status | Penalty (Rs) | Action

  // Wait for table to be fully rendered
  await page.waitForSelector('table tbody tr, table tr', { timeout: 10000 }).catch(() => {});

  // Find column indices dynamically from header
  const colMap = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table th, table thead td'));
    const map = {};
    headers.forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase();
      if (/challan\s*no/i.test(t))              map.challanNo = i;
      if (/violation\s*date/i.test(t))          map.violationDate = i;
      if (/violation\s*loc/i.test(t))           map.location = i;
      if (/penalty\s*person|person/i.test(t))   map.person = i;
      if (/vehicle\s*regt|vehicle\s*reg/i.test(t)) map.vehicleReg = i;
      if (/status/i.test(t))                    map.status = i;
      if (/penalty\s*\(rs\)|penalty|amount/i.test(t)) map.amount = i;
    });
    return map;
  });

  emitStatus(`[JH] Column map: ${JSON.stringify(colMap)}`);

  // If dynamic map fails, use known positions from images
  // Sl.No(0) | Challan No(1) | Violation Date/Time(2) | Violation Location(3) |
  // Penalty Person(4) | Vehicle Regt. No.(5) | DL Number(6) | Status(7) | Penalty(Rs)(8) | Action(9)
  const C = {
    challanNo:    colMap.challanNo    ?? 1,
    violationDate: colMap.violationDate ?? 2,
    location:     colMap.location     ?? 3,
    status:       colMap.status       ?? 7,
    amount:       colMap.amount       ?? 8,
  };

  const allRows = await page.locator('table tbody tr, table tr:not(:first-child)').all();
  emitStatus(`[JH] Total rows found: ${allRows.length}`);

  // Collect raw row data from table (before navigating away)
  const rowData = [];
  for (const row of allRows) {
    const cells = await row.locator('td').allTextContents().catch(() => []);
    if (cells.length < 5) continue;  // skip header/empty rows

    const challanNo   = cells[C.challanNo]?.trim()     || '';
    const dateRaw     = cells[C.violationDate]?.trim()  || '';
    const location    = cells[C.location]?.trim()       || '';
    const statusText  = cells[C.status]?.trim()         || '';
    const amountRaw   = cells[C.amount]?.trim()         || '';
    const hasPayBtn   = await row.locator('a:has-text("Pay"), button:has-text("Pay")').count().catch(() => 0) > 0;

    if (!challanNo) continue;

    // Only process Pending challans
    if (!/pending/i.test(statusText)) {
      emitStatus(`[JH] Skipping challan ${challanNo} (status: ${statusText})`);
      continue;
    }

    const amount      = parseAmount(amountRaw);
    const amountNum   = parseInt(amount, 10) || 0;

    // ONLINE / OFFLINE determination
    let challanType;
    if (amountNum > 0 && !hasPayBtn) {
      challanType = 'OFFLINE';
    } else {
      challanType = 'ONLINE';
    }

    rowData.push({
      challanNo,
      dateRaw,
      location,
      amount,
      amountNum,
      hasPayBtn,
      challanType,
      row,  // keep row locator for clicking View later
    });
  }

  emitStatus(`[JH] Pending challans to process: ${rowData.length}`);
  if (rowData.length === 0) {
    emitStatus('No pending challans found on Jharkhand Traffic Police portal.');
    return [];
  }

  // ── Visit View page for each Pending challan ─────────────────────────────
  const results = [];

  for (const rd of rowData) {
    emitStatus(`[JH] Processing challan: ${rd.challanNo}…`);

    // Find & click the View button in this row
    const viewBtn = rd.row.locator('a:has-text("View"), button:has-text("View")').first();
    if (await viewBtn.count().catch(() => 0) === 0) {
      emitStatus(`[JH] No View button for ${rd.challanNo} — skipping`);
      continue;
    }

    await viewBtn.click();
    emitStatus('[JH] Navigated to View detail page…');

    // Wait for detail page to load
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(800);

    // Extract Act & Section
    const actSection = await extractActAndSection(page, emitStatus);

    // Determine final amount: if 0, look up from Excel
    let finalAmount = rd.amount;
    if (rd.amountNum === 0 && actSection) {
      const looked = offenceMap.get(actSection.toLowerCase().trim());
      if (looked) {
        finalAmount = String(looked);
        emitStatus(`[JH] Amount looked up from Excel for "${actSection}": ${finalAmount}`);
      }
    }

    // ── Screenshot the detail page (with PII masked) ────────────────────
    // Mask by CSS selector (label cells)
    const cleanup1 = await applyPIIMasks(page, [
      'td:has-text("Challan Number"), td:has-text("Challan No")',
      'td:has-text("Vehicle No"), td:has-text("Registration No")',
    ]).catch(async () => async () => {});

    // Mask by exact text value: challan number, registration number, and any chassis/engine
    const cleanup2 = await applyPIIMasksByText(page, [
      rd.challanNo,
      registrationNumber.toUpperCase(),
    ]).catch(async () => async () => {});

    const imageBuffer = await page.screenshot({ fullPage: false }).catch(
      () => page.screenshot({ fullPage: false })
    );
    await cleanup1();
    await cleanup2();

    // ── Build result row ────────────────────────────────────────────────
    results.push({
      noticeNo:        rd.challanNo,
      vehicleNumber:   registrationNumber.toUpperCase(),
      offenceDate:     parseDate(rd.dateRaw),
      offenceDetail:   actSection || 'Jharkhand Traffic Challan',
      offenceLocation: rd.location,
      penaltyAmount:   finalAmount,
      status:          'Unpaid',
      challanType:     rd.challanType,
      challanCourt:    CHALLAN_COURT,
      imageBuffer,
    });

    emitStatus(`[JH] Challan processed: ${rd.challanNo} | ${actSection} | ₹${finalAmount} | ${rd.challanType}`);

    // ── Navigate back to results table ──────────────────────────────────
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
      // If goBack fails, re-navigate + re-submit (shouldn't normally happen)
      emitStatus('[JH] goBack failed — re-navigating…');
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    });
    await page.waitForTimeout(600);
  }

  return results;
}
