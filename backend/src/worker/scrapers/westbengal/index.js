/**
 * West Bengal (SANJOG) eChallan scraper
 * Site: https://sanjog.wb.gov.in/payFine
 *
 * No CAPTCHA. Auth: Vehicle Number + last-5 digits of Chassis Number.
 *
 * Confirmed DOM structure (from live inspection):
 *  - Provider table ID : #tbl_provider_details
 *    Columns: Sl. No. | Provider | Total Count | Total Amount (Rs.) | Details
 *    Eye button: <i class="fa fa-eye btn btn-inverse-primary" onclick="getProviderChallanDetails(this);">
 *    (onclick is ON the <i> element itself — no parent button/anchor)
 *
 *  - Challan details table ID : #tbl_challan_details  (NOT a modal — same page, populated via AJAX)
 *    Columns: Provider | Case Number | Fine Amount | Offence | Place | Case Type | Case Date | Image
 *
 *  - Search button ID : #btn_fetch_challan
 *
 * Flow:
 *  1. Navigate → click "Pay Your Pending Challan" → fill form → click #btn_fetch_challan
 *  2. Wait for #tbl_provider_details to load
 *  3. Outer loop: paginate #tbl_provider_details
 *     - For each provider row: click the <i.fa-eye> directly (onclick handler on icon)
 *     - Wait for #tbl_challan_details to populate with real rows
 *     - Inner loop: read all pages of #tbl_challan_details
 *  4. Return all collected rows
 */
import { applyPIIMasks, applyPIIMasksByText } from '../../../utils/maskPII.js';
import { getOffenceMap }  from '../../../utils/offenceMap.js';

const SITE_URL = 'https://sanjog.wb.gov.in/';

export const id            = 'westbengal';
export const label         = 'West Bengal (SANJOG)';
export const CHALLAN_COURT = 'West Bengal Police';   // fallback — real value from Provider column
export const requiresOtp   = false;

// ── Confirmed selectors (from live DOM inspection) ────────────────────────────
const SEL_PAY_BTN         = 'a[href*="payFine"], a:has-text("Pay Your Pending Challan")';
const SEL_SEARCH_BTN      = '#btn_fetch_challan';
const SEL_PROVIDER_TABLE  = '#tbl_provider_details';
const SEL_CHALLAN_TABLE   = '#tbl_challan_details';
const SEL_EYE_ICON        = '#tbl_provider_details tbody tr i.fa-eye';  // <i> has onclick directly
const SEL_PROVIDER_NEXT   = '#tbl_provider_details_next';               // DataTables convention
const SEL_CHALLAN_NEXT    = '#tbl_challan_details_next';

// Challan table column indices (0-based) — confirmed from headers
const COL_PROVIDER  = 0;
const COL_CASE_NO   = 1;
const COL_AMOUNT    = 2;
const COL_OFFENCE   = 3;
const COL_PLACE     = 4;
const COL_CASE_TYPE = 5;
const COL_CASE_DATE = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "20-Mar-2026" → "2026-03-20" */
function parseDate(raw) {
  if (!raw) return '';
  const months = {
    jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
    jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  };
  const m = String(raw).match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (m) {
    const [, d, mon, y] = m;
    return `${y}-${months[mon.toLowerCase()] || '01'}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return raw;
}

/** "500.0" → { amount:"500", isOffline:false }  |  "5000.0 (Pending in court)" → { amount:"5000", isOffline:true } */
function parseFineAmount(raw) {
  const str       = String(raw || '');
  const isOffline = /pending in court/i.test(str);
  const numMatch  = str.match(/[\d,]+(?:\.\d+)?/);
  const amount    = numMatch
    ? String(Math.round(parseFloat(numMatch[0].replace(/,/g, ''))))
    : '';
  return { amount, isOffline };
}

/** Read all tbody rows from a table by selector. Returns string[][] */
async function readTableRows(page, tableSel) {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr')).map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
    ).filter(cells => cells.some(c => c.length > 0));
  }, tableSel);
}

/** Returns true if the table currently shows the "no data" placeholder row */
async function tableIsEmpty(page, tableSel) {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    if (!table) return true;
    const bodyText = table.querySelector('tbody')?.textContent || '';
    return /no data available/i.test(bodyText);
  }, tableSel);
}

/**
 * Click the eye <i> for provider row at rowIndex (0-based) in #tbl_provider_details.
 * The onclick handler is ON the <i> element itself: onclick="getProviderChallanDetails(this);"
 */
async function clickEyeForRow(page, rowIndex, emitStatus) {
  const result = await page.evaluate((idx) => {
    const table = document.querySelector('#tbl_provider_details');
    if (!table) return { ok: false, reason: 'provider table not found' };

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (idx >= rows.length) return { ok: false, reason: `row ${idx} out of range (${rows.length} rows)` };

    const row = rows[idx];
    const icon = row.querySelector('i.fa-eye');
    if (!icon) return { ok: false, reason: 'no i.fa-eye in row' };

    // The onclick is directly on the <i> — click it
    icon.click();
    return { ok: true, providerText: row.querySelectorAll('td')[1]?.textContent.trim() || '' };
  }, rowIndex);

  emitStatus(`[WB] Eye click row ${rowIndex}: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Wait for #tbl_challan_details to populate with real data after eye click.
 * Returns true when data is loaded, false on timeout.
 */
async function waitForChallanTable(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isEmpty = await tableIsEmpty(page, SEL_CHALLAN_TABLE);
    if (!isEmpty) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * DataTables "Next" button click. Returns true if page changed.
 * Uses confirmed DataTables ID convention: #<tableId>_next
 */
async function clickNextAndCheck(page, nextBtnSel, firstCellSel) {
  return page.evaluate((btnSel, cellSel) => {
    const btn = document.querySelector(btnSel);
    if (!btn) return { clicked: false, reason: 'no next button' };

    const li = btn.closest('li');
    const cls = ((btn.className || '') + ' ' + (li?.className || '')).toLowerCase();
    if (/disabled/.test(cls)) return { clicked: false, reason: 'disabled' };

    const firstCellBefore = document.querySelector(cellSel)?.textContent?.trim() || '';
    btn.click();
    return { clicked: true, firstCellBefore };
  }, nextBtnSel, firstCellSel).then(async (pre) => {
    if (!pre.clicked) return false;
    await page.waitForTimeout(800);
    const firstCellAfter = await page.evaluate(
      (sel) => document.querySelector(sel)?.textContent?.trim() || '',
      firstCellSel
    );
    return pre.firstCellBefore !== firstCellAfter;
  });
}

// ── Main scraper ─────────────────────────────────────────────────────────────

export async function run(page, context, helpers) {
  const { registrationNumber, chassisNumber, sessionId } = context;
  const { emitStatus } = helpers;
  const offenceMap = getOffenceMap();

  const chassisLast5 = (chassisNumber || '').slice(-5);

  emitStatus('Opening West Bengal SANJOG portal…');
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // ── Click "Pay Your Pending Challan" ─────────────────────────────────────
  emitStatus('Clicking Pay Your Pending Challan…');
  await page.locator(SEL_PAY_BTN).first().click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);

  // ── Discover input selectors dynamically (IDs may vary) ──────────────────
  const inputSelectors = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
    const vehicleEl = inputs.find(i => /vehicle|reg/i.test(i.placeholder + i.id + i.name)) || inputs[0];
    const chassisEl = inputs.find(i => /chassis|last|digit/i.test(i.placeholder + i.id + i.name)) || inputs[1];
    const toSel = (el) => {
      if (!el) return null;
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.name) return `[name="${CSS.escape(el.name)}"]`;
      return null;
    };
    return { vehicleSel: toSel(vehicleEl), chassisSel: toSel(chassisEl) };
  });

  const vehicleSel = inputSelectors.vehicleSel || 'input[type="text"]:nth-of-type(1)';
  const chassisSel = inputSelectors.chassisSel || 'input[type="text"]:nth-of-type(2)';
  emitStatus(`[WB] Inputs: vehicle="${vehicleSel}" chassis="${chassisSel}"`);

  await page.fill(vehicleSel, registrationNumber.toUpperCase());
  await page.fill(chassisSel, chassisLast5);
  emitStatus(`[WB] Filled: ${registrationNumber.toUpperCase()} / chassis last-5: ${chassisLast5}`);

  // ── Click search button ───────────────────────────────────────────────────
  await page.locator(SEL_SEARCH_BTN).click();
  emitStatus('[WB] Search submitted — waiting for Provider Challan Details…');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // ── Wait for provider table to load ──────────────────────────────────────
  const outcome = await Promise.race([
    page.waitForFunction(
      () => {
        const t = document.querySelector('#tbl_provider_details');
        if (!t) return false;
        const body = t.querySelector('tbody')?.textContent || '';
        return body.trim().length > 0;
      },
      { timeout: 30000 }
    ).then(() => 'results'),
    page.waitForFunction(
      () => /No data available in table/i.test(
        document.querySelector('#tbl_provider_details tbody')?.textContent || ''
      ),
      { timeout: 30000 }
    ).then(() => 'no_data'),
  ]).catch(() => 'timeout');

  const pageSnap = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '');
  emitStatus(`[WB] Outcome: ${outcome} | Page: ${pageSnap.replace(/\s+/g,' ').slice(0,200)}`);

  if (outcome === 'no_data') {
    emitStatus('No challans found on West Bengal SANJOG portal.');
    return [];
  }

  if (outcome === 'timeout') {
    emitStatus(`[WB] Timeout waiting for results. Chassis used: ${chassisLast5} (full: ${chassisNumber})`);
    throw new Error(
      `West Bengal SANJOG search timed out. Chassis last-5 used: "${chassisLast5}". ` +
      `If wrong, correct chassis number in OMS.`
    );
  }

  // Extra wait for DataTables to finish rendering
  await page.waitForTimeout(1000);

  // ── Outer loop — Provider Challan Details (#tbl_provider_details) ─────────
  const results = [];
  let outerPage = 0;

  outerLoop: while (true) {
    outerPage++;
    emitStatus(`[WB] Provider table page ${outerPage}…`);

    const providerRows = await readTableRows(page, SEL_PROVIDER_TABLE);
    emitStatus(`[WB] Provider rows: ${providerRows.length}`);

    if (providerRows.length === 0) break;

    // Check if it's a "no data" page
    if (providerRows.length === 1 && /no data/i.test(providerRows[0].join(' '))) break;

    for (let rowIdx = 0; rowIdx < providerRows.length; rowIdx++) {
      // Provider name is column 1 (Sl.No. | Provider | Total Count | Total Amount | Details)
      const providerName = providerRows[rowIdx][1] || CHALLAN_COURT;
      emitStatus(`[WB] Provider [${rowIdx}]: "${providerName}"`);

      // Click the eye icon for this row
      const clickResult = await clickEyeForRow(page, rowIdx, emitStatus);
      if (!clickResult.ok) {
        emitStatus(`[WB] Skipping row ${rowIdx} — ${clickResult.reason}`);
        continue;
      }

      // Wait for #tbl_challan_details to populate
      emitStatus('[WB] Waiting for challan details to load…');
      const loaded = await waitForChallanTable(page, 10000);
      if (!loaded) {
        emitStatus(`[WB] Challan table did not populate for "${providerName}" — skipping`);
        continue;
      }

      await page.waitForTimeout(500); // let DataTables finish

      // ── Inner loop — Challan Details (#tbl_challan_details) ──────────────
      let innerPage = 0;
      let lastFirstCaseNo = null;

      while (true) {
        innerPage++;
        emitStatus(`[WB] Challan table page ${innerPage} for "${providerName}"…`);

        const challanRows = await readTableRows(page, SEL_CHALLAN_TABLE);
        emitStatus(`[WB] Challan rows: ${challanRows.length}`);

        if (challanRows.length === 0) break;
        if (challanRows.length === 1 && /no data/i.test(challanRows[0].join(' '))) break;

        // Detect infinite loop (page didn't change)
        const firstCaseNo = challanRows[0]?.[COL_CASE_NO] || '';
        if (lastFirstCaseNo !== null && lastFirstCaseNo === firstCaseNo) {
          emitStatus('[WB] Challan table page unchanged — last page');
          break;
        }
        lastFirstCaseNo = firstCaseNo;

        // ── Take ONE screenshot for this entire challan page ──────────────
        // Scroll challan table into view first
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, SEL_CHALLAN_TABLE);
        await page.waitForTimeout(300);

        // ── PII Masking ────────────────────────────────────────────────────
        // 1. CSS selector masks: Case Number column cells + input fields
        const maskSelectors = [
          `${SEL_CHALLAN_TABLE} tbody td:nth-child(${COL_CASE_NO + 1})`,  // Case Number column
          vehicleSel,   // vehicle number input
          chassisSel,   // chassis last-5 input
        ].filter(Boolean);
        const cleanupCss = await applyPIIMasks(page, maskSelectors).catch(async () => async () => {});

        // 2. Text-based masks: vehicle number wherever it appears as plain text
        //    (e.g. in the Summary section "WB02AN5500" shown as a value)
        //    Also mask each case number on this page
        const caseNosOnPage = challanRows
          .map(r => r[COL_CASE_NO])
          .filter(Boolean);
        const textValuesToMask = [
          registrationNumber.toUpperCase(),
          chassisLast5,
          ...caseNosOnPage,
        ].filter(Boolean);
        const cleanupText = await applyPIIMasksByText(page, textValuesToMask).catch(async () => async () => {});

        const cleanup = async () => {
          await cleanupCss();
          await cleanupText();
        };

        // Find the "Challan Details" card/section (parent of the table heading + table)
        // Falls back to screenshotting the table itself
        const imageBuffer = await page.evaluate((sel) => {
          const table = document.querySelector(sel);
          if (!table) return null;
          // Walk up to find a card/section container
          let el = table.parentElement;
          while (el && el !== document.body) {
            if (el.tagName === 'DIV' && (
              el.className.includes('card') ||
              el.className.includes('panel') ||
              el.className.includes('section') ||
              el.querySelector('h3, h4, h5')
            )) return el.id || el.className.split(' ')[0] || null;
            el = el.parentElement;
          }
          return null;
        }, SEL_CHALLAN_TABLE).then(async (containerCls) => {
          let targetLocator;
          if (containerCls) {
            // Try the identified container first
            const byId  = page.locator(`#${containerCls}`).first();
            const byCls = page.locator(`.${containerCls}`).first();
            const cnt   = await byId.count();
            targetLocator = cnt > 0 ? byId : byCls;
          }
          if (!targetLocator || await targetLocator.count() === 0) {
            // Fall back to just the table
            targetLocator = page.locator(SEL_CHALLAN_TABLE).first();
          }
          return targetLocator.screenshot().catch(() => page.screenshot({ fullPage: false }));
        });

        if (typeof cleanup === 'function') await cleanup();

        // ── Process each data row using the shared screenshot ──────────────
        for (const cells of challanRows) {
          if (cells.length < 3) continue;

          const caseNumber  = cells[COL_CASE_NO]   || '';
          const fineAmtRaw  = cells[COL_AMOUNT]     || '';
          const offence     = cells[COL_OFFENCE]    || '';
          const place       = cells[COL_PLACE]      || '';
          const caseDateRaw = cells[COL_CASE_DATE]  || '';
          // Use provider from row's own col 0; fall back to outer provider name
          const rowProvider = cells[COL_PROVIDER]?.trim() || providerName;

          if (!caseNumber) continue;

          const { amount: parsedAmount, isOffline } = parseFineAmount(fineAmtRaw);
          let finalAmount = parsedAmount;

          // Excel fallback when amount is 0 or empty
          if ((!finalAmount || finalAmount === '0') && offence) {
            const looked = offenceMap.get(offence.toLowerCase().trim());
            if (looked) {
              finalAmount = String(looked);
              emitStatus(`[WB] Amount from Excel for "${offence}": ${finalAmount}`);
            }
          }

          results.push({
            noticeNo:        caseNumber,
            vehicleNumber:   registrationNumber.toUpperCase(),
            offenceDate:     parseDate(caseDateRaw),
            offenceDetail:   offence || 'West Bengal Traffic Challan',
            offenceLocation: place,
            penaltyAmount:   finalAmount,
            status:          'Unpaid',
            challanType:     isOffline ? 'OFFLINE' : 'ONLINE',
            challanCourt:    rowProvider,
            imageBuffer,        // same screenshot for all rows on this page
          });

          emitStatus(`[WB] ✓ ${caseNumber} | ${offence} | ₹${finalAmount} | ${isOffline ? 'OFFLINE' : 'ONLINE'} | ${rowProvider}`);
        }

        // Paginate challan table
        const innerChanged = await clickNextAndCheck(
          page,
          SEL_CHALLAN_NEXT,
          `${SEL_CHALLAN_TABLE} tbody tr:first-child td:nth-child(${COL_CASE_NO + 1})`
        ).catch(() => false);

        if (!innerChanged) {
          emitStatus(`[WB] Challan table last page for "${providerName}"`);
          break;
        }
      }
    }

    // Paginate provider table
    const outerChanged = await clickNextAndCheck(
      page,
      SEL_PROVIDER_NEXT,
      `${SEL_PROVIDER_TABLE} tbody tr:first-child td:nth-child(2)`
    ).catch(() => false);

    if (!outerChanged) {
      emitStatus('[WB] Provider table last page — done');
      break;
    }
  }

  emitStatus(`[WB] Total challans collected: ${results.length}`);
  return results;
}
