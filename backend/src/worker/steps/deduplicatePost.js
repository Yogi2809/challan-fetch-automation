import path from 'path';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { getExistingChallans } from '../../services/omsService.js';
import { postChallan } from '../../services/challanService.js';
import { lookupOffenceAmount } from '../../utils/offenceLookup.js';

const DEFAULT_COURT      = 'Delhi(Traffic Department)';
const DEFAULT_CREATED_BY = 'yogesh.mishra@cars24.com';

export async function deduplicateAndPost({
  appointmentId,
  sessionId,
  createdBy,
  scrapedRows,
  challanCourt,         // passed from scraper via automation.js
  offenceLookupMap,
  emitStatus,
}) {
  let existing = [];
  try {
    existing = await getExistingChallans(appointmentId);
  } catch (err) {
    // 500 / 404 means no challans stored yet — treat as empty (post all)
    const apiErr = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    emitStatus(`Note: could not fetch existing challans (${apiErr}) — posting all scraped rows`);
  }
  const existingNos = new Set(existing.map(c => c.noticeNumber ?? c.noticeNo ?? ''));

  const newRows = scrapedRows.filter(r => !existingNos.has(r.noticeNo));
  emitStatus(`${newRows.length} new challan(s) to post (${scrapedRows.length - newRows.length} duplicate(s) skipped)`);

  const posted = [];

  for (const row of newRows) {
    let amount = row.penaltyAmount || '';
    if (!amount) {
      const { amount: xlsxAmt } = lookupOffenceAmount(row.offenceDetail, offenceLookupMap);
      amount = xlsxAmt != null ? String(xlsxAmt) : '';
    }

    const tmpDir = '/tmp/challan-proofs';
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const proofPath = path.join(tmpDir, `${sessionId}-${row.noticeNo}.jpg`);
    if (!row.imageBuffer) {
      emitStatus(`Warning: no image for challan ${row.noticeNo}, skipping upload`);
      posted.push({ noticeNo: row.noticeNo, success: false, error: 'No image available' });
      continue;
    }
    writeFileSync(proofPath, row.imageBuffer);

    const payload = {
      appointmentId,
      challanName:  row.offenceDetail || 'Unknown Offence',
      challanType:  row.challanType   || 'OFFLINE',
      noticeNumber: row.noticeNo,
      amount,
      createdBy:    createdBy         || DEFAULT_CREATED_BY,
      offenceDate:  row.offenceDate   || '',
      // row.challanCourt set by automation.js from scraper.CHALLAN_COURT
      challanCourt: row.challanCourt || challanCourt || DEFAULT_COURT,
    };

    try {
      const result = await postChallan(payload, proofPath);
      if (result?.customCode === 'CHALLAN208' || result?.status === 208) {
        posted.push({ noticeNo: row.noticeNo, success: true, alreadyExists: true });
        emitStatus(`Challan ${row.noticeNo} already exists in admin panel — skipped`);
      } else {
        posted.push({ noticeNo: row.noticeNo, success: true, alreadyExists: false });
        emitStatus(`Posted challan ${row.noticeNo} ✓`);
      }
    } catch (err) {
      const apiError = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
      console.error(`[deduplicatePost] noticeNo=${row.noticeNo} API error:`, apiError);
      posted.push({ noticeNo: row.noticeNo, success: false, error: apiError });
      emitStatus(`Failed to post challan ${row.noticeNo}: ${apiError}`);
    }

    try { unlinkSync(proofPath); } catch (_) {}
  }

  return posted;
}
