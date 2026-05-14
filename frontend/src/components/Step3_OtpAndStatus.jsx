import React, { useState } from 'react';
import { submitOtp, reassignJob, markManual } from '../api.js';

export default function Step3_OtpAndStatus({
  sessionId,
  logs,
  progress,
  otpRequired,
  otpSite,       // e.g. "Delhi(Traffic Department)" — which scraper is asking
  otpSent,       // controlled by parent — resets to false on each new OTP request
  onOtpSent,     // call when OTP submitted successfully
  jobError,
}) {
  const [otp, setOtp]               = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError]     = useState('');

  async function handleOtpSubmit(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setOtpError('OTP must be exactly 6 digits');
    setOtpLoading(true);
    setOtpError('');
    try {
      await submitOtp(sessionId, otp);
      setOtp('');          // clear input so it's ready for a potential next OTP
      onOtpSent();         // tell parent: first OTP done
    } catch (err) {
      setOtpError(err.response?.data?.error || err.message);
    } finally {
      setOtpLoading(false);
    }
  }

  async function handleReassign() {
    try { await reassignJob(sessionId); } catch (_) {}
    window.location.href = '/';
  }

  async function handleManual() {
    try { await markManual(sessionId); } catch (_) {}
    alert('Job marked as manual. Please handle this challan manually.');
  }

  const siteLabel = otpSite || 'traffic police portal';

  return (
    <div className="space-y-6">

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span><span>{progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* OTP box — shown whenever a scraper is waiting, resets for each new request */}
      {otpRequired && !otpSent && !jobError && (
        <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4">
          <p className="text-sm font-semibold text-yellow-800 mb-1">
            OTP Required — {siteLabel}
          </p>
          <p className="text-xs text-yellow-700 mb-3">
            Enter the 6-digit OTP sent to the registered mobile number for&nbsp;
            <span className="font-medium">{siteLabel}</span>.
          </p>
          <form onSubmit={handleOtpSubmit} className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit OTP"
              maxLength={6}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={otpLoading}
              className="bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white rounded-lg px-4 py-2 text-sm font-medium transition"
            >
              {otpLoading ? '…' : 'Submit OTP'}
            </button>
          </form>
          {otpError && <p className="text-red-500 text-xs mt-2">{otpError}</p>}
        </div>
      )}

      {/* Confirmation after OTP submitted — disappears when next OTP is requested */}
      {otpSent && !otpRequired && (
        <p className="text-green-600 text-sm font-medium">✓ OTP submitted — processing…</p>
      )}
      {otpSent && otpRequired && (
        // otpSent was true but parent reset otpRequired for a new request — handled above
        null
      )}

      {/* Error state */}
      {jobError && (
        <div className="border border-red-300 bg-red-50 rounded-xl p-4">
          <p className="text-red-700 text-sm font-semibold mb-2">Automation Error</p>
          <p className="text-red-600 text-sm mb-4">{jobError}</p>
          <div className="flex gap-3">
            <button onClick={handleReassign}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition">
              Try Again
            </button>
            <button onClick={handleManual}
              className="bg-gray-500 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition">
              Mark as Manual
            </button>
          </div>
        </div>
      )}

      {/* Live log console */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-2">Live Status</h3>
        <div className="bg-gray-900 rounded-xl p-3 h-48 overflow-y-auto font-mono text-xs text-green-400 space-y-1">
          {logs.length === 0
            ? <p className="text-gray-500">Waiting for updates…</p>
            : logs.map((log, i) => <p key={i}>{log}</p>)
          }
        </div>
      </div>

    </div>
  );
}
