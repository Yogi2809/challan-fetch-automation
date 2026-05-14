import React from 'react';

export default function Step4_Results({ results, sessionId }) {
  const rows = results?.scrapedRows ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-700">
          Results — {rows.length} challan(s) found
        </h2>
        <span className={`px-2 py-1 rounded text-xs font-semibold ${
          rows.length > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {rows.length > 0 ? 'Challans Found' : 'Clean'}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center">
          No pending challans found for this vehicle. ✓
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-blue-600 text-white">
                <th className="px-3 py-2 text-left font-medium">Notice No</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Offence</th>
                <th className="px-3 py-2 text-left font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.noticeNo ?? i}
                  className={`border-t border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-3 py-2 font-mono text-gray-700">{row.noticeNo}</td>
                  <td className="px-3 py-2 text-gray-600">{row.offenceDate}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-gray-700" title={row.offenceDetail}>
                    {row.offenceDetail}
                  </td>
                  <td className="px-3 py-2 text-gray-700">₹{row.penaltyAmount || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-semibold
                      ${row.challanType === 'ONLINE' ? 'bg-green-500' : 'bg-orange-400'}`}>
                      {row.challanType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 truncate max-w-[120px]">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">Session ID: {sessionId}</p>
    </div>
  );
}
