import React from 'react';

function TypeBadge({ type }) {
  const online = type === 'ONLINE';
  return (
    <span className={[
      'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide',
      online
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-orange-100 text-orange-700',
    ].join(' ')}>
      {online ? '⚡ ONLINE' : '🏛 OFFLINE'}
    </span>
  );
}

function SubmitBadge({ result }) {
  if (!result) return null;
  if (result.alreadyExists)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-semibold">
        Already exists
      </span>
    );
  if (result.success)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
        ✓ Posted
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 text-red-600 text-[10px] font-semibold" title={result.error}>
      ✕ Failed
    </span>
  );
}

export default function ChallanTable({
  rows = [],
  sessionId,
  onSubmit,
  onSkip,
  submitLoading,
  submitted,
  submitResults,
  // Optional: show source column (for PendingChallansTab)
  showSource = false,
}) {
  const resultMap = submitResults
    ? Object.fromEntries((submitResults).map(r => [r.noticeNo, r]))
    : null;

  const totalAmount = rows.reduce((sum, r) => sum + (parseInt(r.penaltyAmount, 10) || 0), 0);

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-slate-700">
            {rows.length} challan{rows.length !== 1 ? 's' : ''}
          </span>
          {rows.length > 0 && (
            <span className="text-xs text-slate-400">·</span>
          )}
          {totalAmount > 0 && (
            <span className="text-xs font-medium text-slate-500">
              Total ₹{totalAmount.toLocaleString('en-IN')}
            </span>
          )}
        </div>
        {rows.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" />
            </svg>
            Pending
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-400">
          No challans found for this vehicle ✓
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800 text-slate-200">
                  {showSource && (
                    <th className="px-3.5 py-2.5 text-left font-semibold tracking-wide text-[10px] uppercase">Source</th>
                  )}
                  <th className="px-3.5 py-2.5 text-left font-semibold tracking-wide text-[10px] uppercase">Notice No</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold tracking-wide text-[10px] uppercase">Date</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold tracking-wide text-[10px] uppercase">Offence</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold tracking-wide text-[10px] uppercase">Amount</th>
                  <th className="px-3.5 py-2.5 text-left font-semibold tracking-wide text-[10px] uppercase">Type</th>
                  {resultMap && (
                    <th className="px-3.5 py-2.5 text-left font-semibold tracking-wide text-[10px] uppercase">Result</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, i) => (
                  <tr key={row.noticeNo ?? i}
                    className="bg-white hover:bg-slate-50/70 transition-colors">
                    {showSource && (
                      <td className="px-3.5 py-2.5">
                        <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md whitespace-nowrap">
                          {row.source}
                        </span>
                      </td>
                    )}
                    <td className="px-3.5 py-2.5 font-mono text-slate-700 font-medium whitespace-nowrap">
                      {row.noticeNo}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{row.offenceDate}</td>
                    <td className="px-3.5 py-2.5 text-slate-600 max-w-[200px]">
                      <span className="block truncate" title={row.offenceDetail}>
                        {row.offenceDetail}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                      {row.penaltyAmount && parseInt(row.penaltyAmount, 10) > 0
                        ? `₹${parseInt(row.penaltyAmount, 10).toLocaleString('en-IN')}`
                        : <span className="text-slate-400 font-normal">—</span>
                      }
                    </td>
                    <td className="px-3.5 py-2.5">
                      <TypeBadge type={row.challanType} />
                    </td>
                    {resultMap && (
                      <td className="px-3.5 py-2.5">
                        <SubmitBadge result={resultMap[row.noticeNo]} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!submitted && rows.length > 0 && onSubmit && (
        <div className="flex gap-2.5 pt-1">
          <button
            onClick={onSubmit}
            disabled={submitLoading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400
                       text-white rounded-xl py-2.5 text-sm font-semibold transition
                       flex items-center justify-center gap-2 shadow-sm"
          >
            {submitLoading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Submitting…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Submit {rows.length} Challan{rows.length !== 1 ? 's' : ''} to Admin Panel
              </>
            )}
          </button>
          {onSkip && (
            <button
              onClick={onSkip}
              disabled={submitLoading}
              className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-medium transition"
            >
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}
