import React, { useState } from 'react';
import { submitJob, getJobStatus } from '../api.js';
import ChallanTable from './ChallanTable.jsx';

function StatCard({ label, value, sub, color = 'indigo' }) {
  const colorMap = {
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    red:    'bg-red-50   border-red-100   text-red-700',
    emerald:'bg-emerald-50 border-emerald-100 text-emerald-700',
    amber:  'bg-amber-50  border-amber-100  text-amber-700',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color] || colorMap.indigo}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest opacity-60">{label}</p>
      <p className="text-2xl font-bold mt-0.5 leading-none">{value}</p>
      {sub && <p className="text-[11px] mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

export default function PendingChallansTab({ rows = [], scrapers = [], scraperResults = {}, tabStatuses = {} }) {
  const [submitting,    setSubmitting]    = useState(false);
  const [submitted,     setSubmitted]     = useState(false);
  const [submitResults, setSubmitResults] = useState(null);  // flat array of per-row results
  const [submitError,   setSubmitError]   = useState('');
  const [submitProgress, setSubmitProgress] = useState('');

  const totalAmount = rows.reduce((s, r) => s + (parseInt(r.penaltyAmount, 10) || 0), 0);
  const onlineCount = rows.filter(r => r.challanType === 'ONLINE').length;
  const offlineCount = rows.length - onlineCount;

  // Unique sessionIds (one per scraper that found challans)
  const sessionIds = [...new Set(
    rows.map(r => r.sessionId).filter(Boolean)
  )];

  async function handleSubmitAll() {
    setSubmitting(true);
    setSubmitError('');
    const allPosted = [];

    for (let i = 0; i < sessionIds.length; i++) {
      const sid = sessionIds[i];
      setSubmitProgress(`Submitting ${i + 1} of ${sessionIds.length}…`);
      try {
        await submitJob(sid);

        // Poll until submitted
        let attempts = 0;
        while (attempts < 30) {
          await new Promise(r => setTimeout(r, 1500));
          const job = await getJobStatus(sid).catch(() => null);
          if (!job) break;
          if (job.status === 'submitted' && job.challanRows) {
            const suiteName = scrapers.find(s => {
              const r2 = scraperResults[s.id];
              return r2?.sessionId === sid;
            })?.label || sid;
            for (const row of job.challanRows) {
              allPosted.push({ ...row, source: suiteName });
            }
            break;
          }
          if (job.status === 'failed') break;
          attempts++;
        }
      } catch (e) {
        // Non-fatal — continue with other sessions
        console.warn(`Submit failed for ${sid}:`, e.message);
      }
    }

    setSubmitProgress('');
    setSubmitResults(allPosted);
    setSubmitting(false);
    setSubmitted(true);
  }

  // Build resultMap for ChallanTable (noticeNo → result object)
  const resultMap = submitResults
    ? Object.fromEntries(
        submitResults.map(r => [r.noticeNo, { noticeNo: r.noticeNo, success: true, ...r }])
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">Pending Challans</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Consolidated results from {scrapers.length} traffic portal{scrapers.length !== 1 ? 's' : ''}
          </p>
        </div>
        {submitted && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Submitted
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Challans"
          value={rows.length}
          sub={rows.length === 0 ? 'All clear ✓' : 'across all sites'}
          color={rows.length > 0 ? 'red' : 'emerald'}
        />
        <StatCard
          label="Total Fine"
          value={totalAmount > 0 ? `₹${totalAmount.toLocaleString('en-IN')}` : '—'}
          sub={totalAmount > 0 ? 'cumulative' : 'no amount'}
          color="amber"
        />
        <StatCard label="Online" value={onlineCount}  sub="can pay online" color="emerald" />
        <StatCard label="Offline" value={offlineCount} sub="court payment"  color="indigo" />
      </div>

      {/* Site breakdown */}
      {scrapers.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Site Breakdown</p>
          </div>
          <div className="divide-y divide-slate-100">
            {scrapers.map(s => {
              const result    = scraperResults[s.id];
              const count     = result?.rows?.length ?? 0;
              const hasResult = result !== undefined;
              const st        = tabStatuses[s.id];
              const isSkipped = st === 'skipped';
              const isManualFlag = st === 'manual';
              const needsFlag = isSkipped || isManualFlag;

              return (
                <div key={s.id} className={`flex items-center justify-between px-4 py-2.5 ${needsFlag ? 'bg-amber-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      needsFlag  ? 'bg-amber-400' :
                      !hasResult ? 'bg-slate-300' :
                      count > 0  ? 'bg-red-500'   : 'bg-emerald-500'
                    }`} />
                    <span className={`text-sm ${needsFlag ? 'text-amber-800 font-medium' : 'text-slate-700'}`}>{s.label}</span>
                  </div>
                  <span className={`text-xs font-semibold ${
                    isManualFlag ? 'text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full' :
                    isSkipped    ? 'text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full' :
                    !hasResult   ? 'text-slate-400' :
                    count > 0    ? 'text-red-600'   : 'text-emerald-600'
                  }`}>
                    {isManualFlag ? '⚠ Manual check needed' :
                     isSkipped    ? 'Skipped' :
                     !hasResult   ? 'Not run' :
                     count > 0    ? `${count} challan${count !== 1 ? 's' : ''}` : 'Clean ✓'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No challans state */}
      {rows.length === 0 && (
        <div className="text-center py-12 bg-emerald-50 rounded-2xl border border-emerald-100">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-base font-bold text-emerald-800">All Clear!</p>
          <p className="text-sm text-emerald-600 mt-1">
            No pending challans found across all {scrapers.length} traffic portals.
          </p>
        </div>
      )}

      {/* Challan table (all sites combined) */}
      {rows.length > 0 && (
        <>
          <ChallanTable
            rows={rows}
            showSource
            submitted={submitted}
            submitResults={submitResults
              ? submitResults.map(r => ({ noticeNo: r.noticeNo, success: true, ...r }))
              : null}
          />

          {/* Submit All */}
          {!submitted && sessionIds.length > 0 && (
            <div className="pt-2">
              {submitError && (
                <p className="text-xs text-red-500 mb-2">{submitError}</p>
              )}
              <button
                onClick={handleSubmitAll}
                disabled={submitting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white
                           rounded-xl py-3.5 text-sm font-bold tracking-tight shadow-sm transition
                           flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    {submitProgress || 'Submitting…'}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Submit All {rows.length} Challans to Admin Panel
                  </>
                )}
              </button>
              <p className="text-center text-[11px] text-slate-400 mt-2">
                Submits challans from all {sessionIds.length} site{sessionIds.length !== 1 ? 's' : ''} in one click
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
