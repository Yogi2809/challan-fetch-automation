import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket }   from '../hooks/useSocket.js';
import {
  startScraper, submitJob, submitOtp, resendOtp,
  submitCaptcha, getJobStatus, reassignJob, markManual,
} from '../api.js';
import ChallanTable from './ChallanTable.jsx';

// ── Small icon helpers ────────────────────────────────────────────────────────
function Spinner({ cls = 'w-4 h-4' }) {
  return (
    <svg className={`animate-spin ${cls}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ value }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Progress</span>
        <span className="text-[11px] font-semibold text-[#4736FE]">{value}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-width"
          style={{ width: `${value}%`, background: 'linear-gradient(to right, #4736FE, #7B73FF)' }}
        />
      </div>
    </div>
  );
}

// ── Log Terminal ──────────────────────────────────────────────────────────────
function LogTerminal({ logs, logEndRef, collapsed = false }) {
  if (collapsed && logs.length === 0) return null;

  const inner = (
    <div className="bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-800/80">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
        <span className="ml-2 text-[10px] text-slate-500 terminal">live log</span>
      </div>
      <div className="p-3 h-40 overflow-y-auto scrollbar-thin terminal text-[11px] text-emerald-400 space-y-0.5 leading-relaxed">
        {logs.length === 0
          ? <p className="text-slate-600">Waiting for updates…</p>
          : logs.map((log, i) => (
              <p key={i} className="text-emerald-400/90 hover:text-emerald-300 transition-colors">{log}</p>
            ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <details className="group">
        <summary className="cursor-pointer flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors select-none list-none">
          <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          View automation log ({logs.length} entries)
        </summary>
        <div className="mt-2">{inner}</div>
      </details>
    );
  }
  return inner;
}

// ── OTP Input Card ────────────────────────────────────────────────────────────
function OtpCard({ site, onSubmit, loading, error, resendLoading, resendMsg, onResend }) {
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setOtpError('OTP must be exactly 6 digits');
    setOtpError('');
    onSubmit(otp);
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2v-2a9 9 0 10-18 0v2a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-900">OTP Required</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Enter the 6-digit OTP sent to the registered mobile for <strong>{site}</strong>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text" inputMode="numeric"
          value={otp}
          onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
          placeholder="• • • • • •"
          maxLength={6}
          className="flex-1 border border-amber-300 bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900
                     placeholder:text-amber-300 font-mono tracking-[0.3em]
                     focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition"
          autoFocus
        />
        <button
          type="submit" disabled={loading}
          className="bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-xl px-4
                     text-sm font-semibold transition flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? <Spinner /> : null}
          {loading ? 'Sending…' : 'Submit OTP'}
        </button>
      </form>

      {(otpError || error) && (
        <p className="text-xs text-red-500">{otpError || error}</p>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={onResend} disabled={resendLoading}
          className="text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2 disabled:opacity-50 transition"
        >
          {resendLoading ? 'Sending…' : 'Resend OTP'}
        </button>
        {resendMsg && <span className="text-xs text-emerald-600">{resendMsg}</span>}
      </div>
    </div>
  );
}

// ── CAPTCHA Input Card ────────────────────────────────────────────────────────
function CaptchaCard({ label, image, onSubmit, loading, error }) {
  const [text, setText] = useState('');
  const [localErr, setLocalErr] = useState('');

  // Reset text when new image arrives (new captcha challenge)
  useEffect(() => { setText(''); setLocalErr(''); }, [image]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return setLocalErr('Please enter the captcha text');
    setLocalErr('');
    onSubmit(text.trim());
  }

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-orange-900">CAPTCHA Required</p>
          <p className="text-xs text-orange-700 mt-0.5">
            Type the characters shown in the image exactly as they appear
          </p>
        </div>
      </div>

      {image && (
        <div className="flex justify-center py-1">
          <div className="rounded-xl border-2 border-orange-200 bg-white p-2 shadow-sm">
            <img
              src={`data:image/png;base64,${image}`}
              alt="CAPTCHA"
              className="max-h-14 rounded-lg"
            />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => { setText(e.target.value); setLocalErr(''); }}
          placeholder="Enter captcha"
          autoComplete="off" autoCorrect="off" spellCheck={false}
          className="flex-1 border border-orange-300 bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900
                     placeholder:text-orange-300
                     focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 transition"
          autoFocus
        />
        <button
          type="submit" disabled={loading}
          className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-xl px-4
                     text-sm font-semibold transition flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? <Spinner /> : null}
          {loading ? 'Verifying…' : 'Submit'}
        </button>
      </form>

      {(localErr || error) && (
        <p className="text-xs text-red-500">{localErr || error}</p>
      )}
    </div>
  );
}

// ── Main ScraperTabPanel ──────────────────────────────────────────────────────
export default function ScraperTabPanel({
  scraper,
  appointment,
  shouldStart,         // true when the orchestrator wants this scraper to auto-start
  isManual,            // true for high-latency scrapers (shows a note)
  isAutomationActive,  // true when any automation mode is running
  onStartSingle,       // () => void — start single-site automation for this tab
  onStartComplete,     // () => void — start complete automation (all sites)
  onEndAutomation,     // () => void — end current automation
  onComplete,          // (rows, sessionId) => void
  onError,             // () => void
  onSkip,              // () => void
}) {
  const { id: scraperId, label } = scraper;
  const { appointmentId, mobileNumber, vehicle } = appointment;

  // ── Core state ──────────────────────────────────────────────────
  const [status,       setStatus]       = useState('idle');
  const [sessionId,    setSessionId]    = useState(null);
  const [logs,         setLogs]         = useState([]);
  const [progress,     setProgress]     = useState(0);
  const [rows,         setRows]         = useState([]);
  const [error,        setError]        = useState(null);

  // OTP
  const [otpRequired,   setOtpRequired]   = useState(false);
  const [otpSite,       setOtpSite]       = useState('');
  const [otpSent,       setOtpSent]       = useState(false);
  const [otpLoading,    setOtpLoading]    = useState(false);
  const [otpError,      setOtpError]      = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg,     setResendMsg]     = useState('');

  // CAPTCHA
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaImage,    setCaptchaImage]    = useState('');
  const [captchaLoading,  setCaptchaLoading]  = useState(false);
  const [captchaError,    setCaptchaError]    = useState('');
  const [captchaSent,     setCaptchaSent]     = useState(false);

  // Submit
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitResult,  setSubmitResult]  = useState(null);

  // SSO expired alert
  const [ssoExpired, setSsoExpired] = useState(false);

  const seenLogs      = useRef(new Set());
  const pollRef       = useRef(null);
  const doneRef       = useRef(false);
  const completedRef  = useRef(false);  // guard onComplete called only once
  const logEndRef     = useRef(null);
  const retryCountRef = useRef(0);      // manual Retry clicks
  const autoRetryRef  = useRef(0);      // automatic retries for network/500 errors

  function addLog(msg) {
    if (!msg || seenLogs.current.has(msg)) return;
    seenLogs.current.add(msg);
    if (msg.startsWith('[SSO_EXPIRED]')) {
      setSsoExpired(true);
      return; // don't clutter the log with this — banner handles it
    }
    setLogs(l => [...l, msg]);
  }

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // ── Auto-start when orchestrator activates this scraper ─────────
  useEffect(() => {
    if (shouldStart && status === 'idle') {
      const t = setTimeout(() => handleStart(), 120);
      return () => clearTimeout(t);
    }
  }, [shouldStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Notify parent when this scraper finishes ─────────────────────
  useEffect(() => {
    if ((status === 'done' || status === 'skipped') && !completedRef.current && sessionId !== null) {
      completedRef.current = true;
      // Brief pause so user can glimpse the result before tab switches
      const t = setTimeout(() => onComplete(rows, sessionId), 600);
      return () => clearTimeout(t);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── REST polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    doneRef.current = false;

    async function poll() {
      if (doneRef.current) return;
      try {
        const job = await getJobStatus(sessionId);
        if (!job) return;
        setProgress(job.progress || 0);
        for (const log of (job.logs || [])) addLog(log.msg);

        if (job.status === 'queued') {
          setStatus('queued');
        }
        if (job.status === 'running' && status === 'queued') {
          setStatus('running');
        }
        if (job.status === 'otp_pending') {
          setOtpRequired(true); setOtpSite(job.otpSite || label); setOtpSent(false);
          setStatus('running');
        }
        if (job.status === 'captcha_pending') {
          setStatus('running'); // captcha comes via socket; just keep running
        }
        if (job.status === 'done') {
          doneRef.current = true; clearInterval(pollRef.current);
          setRows(job.challanRows || []); setStatus('done');
        }
        if (job.status === 'submitted') {
          doneRef.current = true; clearInterval(pollRef.current);
          setRows(job.challanRows || []); setStatus('submitted');
        }
        if (job.status === 'failed' || job.status === 'error') {
          doneRef.current = true; clearInterval(pollRef.current);
          const errMsg = job.error || 'Automation failed';
          if (handleAutoRetryOrFlag(errMsg)) return;
          setError(errMsg); setStatus('error');
          onError();
        }
        if (job.status === 'submitting') setStatus('submitting');
      } catch (_) {}
    }

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket ────────────────────────────────────────────────────────
  const handlers = {
    onStatus:   useCallback(({ msg }) => addLog(msg), []),
    onProgress: useCallback(({ percent }) => setProgress(percent), []),
    onOtpRequired: useCallback(({ site } = {}) => {
      setOtpRequired(true); setOtpSite(site || label);
      setOtpSent(false); setOtpError(''); setStatus('running');
    }, [label]),
    onCaptchaRequired: useCallback(({ image } = {}) => {
      setCaptchaRequired(true); setCaptchaImage(image || '');
      setCaptchaSent(false); setCaptchaError(''); setStatus('running');
    }, []),
    onDone: useCallback((data) => {
      if (doneRef.current) return;
      doneRef.current = true; clearInterval(pollRef.current);
      setRows(data.scrapedRows || []); setStatus('done');
    }, []),
    onError: useCallback(({ message }) => {
      doneRef.current = true; clearInterval(pollRef.current);
      if (handleAutoRetryOrFlag(message)) return;
      setError(message); setStatus('error'); onError();
    }, [onError]),  // eslint-disable-line react-hooks/exhaustive-deps
    onSubmitStarted: useCallback(() => setStatus('submitting'), []),
    onSubmitDone:    useCallback(({ posted }) => {
      setSubmitResult(posted); setStatus('submitted'); clearInterval(pollRef.current);
    }, []),
    onSubmitError:   useCallback(({ message }) => {
      setError(message); setStatus('done'); setSubmitLoading(false);
    }, []),
  };

  useSocket(sessionId, {
    onStatus:          handlers.onStatus,
    onProgress:        handlers.onProgress,
    onOtpRequired:     handlers.onOtpRequired,
    onCaptchaRequired: handlers.onCaptchaRequired,
    onDone:            handlers.onDone,
    onError:           handlers.onError,
    _extraEvents: [
      ['submit_started', handlers.onSubmitStarted],
      ['submit_done',    handlers.onSubmitDone],
      ['submit_error',   handlers.onSubmitError],
    ],
  });

  // ── Actions ───────────────────────────────────────────────────────
  async function handleStart() {
    seenLogs.current = new Set();
    completedRef.current = false;
    setLogs([]); setProgress(0); setRows([]); setError(null);
    setOtpRequired(false); setOtpSent(false); setOtpError(''); setResendMsg('');
    setCaptchaRequired(false); setCaptchaImage(''); setCaptchaSent(false); setCaptchaError('');
    setSubmitResult(null); setSsoExpired(false);
    doneRef.current = false;
    setStatus('queued');
    try {
      const { sessionId: sid } = await startScraper(appointmentId, mobileNumber, scraperId, '', vehicle);
      setSessionId(sid);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setStatus('error');
      onError();
    }
  }

  async function handleRetry() {
    retryCountRef.current += 1;
    // After 3 manual retries — show error, let user decide to skip manually
    if (retryCountRef.current > 3) {
      setError('Maximum retries reached — please check this site manually, then click Skip.');
      setStatus('error');
      onError();
      return;
    }
    completedRef.current = false;
    if (!sessionId) { handleStart(); return; }
    try {
      const { newSessionId } = await reassignJob(sessionId);
      seenLogs.current = new Set();
      setLogs([]); setProgress(0); setRows([]); setError(null);
      setOtpRequired(false); setOtpSent(false); setResendMsg('');
      setCaptchaRequired(false); setCaptchaImage(''); setCaptchaSent(false); setCaptchaError('');
      setSubmitResult(null); setSsoExpired(false);
      doneRef.current = false;
      setStatus('queued');
      setSessionId(newSessionId);
    } catch (_) { handleStart(); }
  }

  // Auto-retry for network/500 errors (max 2 times), then flag as manual
  function handleAutoRetryOrFlag(errMsg) {
    const isNetworkErr = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|net::ERR|ECONNREFUSED|ENOTFOUND|site can.t be reached|500|Internal Server Error/i.test(errMsg);
    if (!isNetworkErr) return false;  // caller should show normal error UI

    autoRetryRef.current += 1;
    if (autoRetryRef.current <= 2) {
      addLog(`[Auto-retry ${autoRetryRef.current}/2] Network/server error — retrying in 5s…`);
      setTimeout(() => handleRetry(), 5000);
      return true;
    }
    // Exhausted auto-retries — show error, let user decide to skip manually
    setStatus('error');
    setError(errMsg);
    onError();
    return true;
  }

  async function handleOtpSubmit(otp) {
    setOtpLoading(true); setOtpError('');
    try {
      await submitOtp(sessionId, otp);
      setOtpSent(true);
    } catch (err) {
      setOtpError(err.response?.data?.error || err.message);
    } finally { setOtpLoading(false); }
  }

  async function handleResendOtp() {
    setResendLoading(true); setResendMsg('');
    try {
      const { message } = await resendOtp(sessionId);
      setResendMsg(message || 'OTP resent');
    } catch (err) {
      setResendMsg(err.response?.data?.error || 'Failed to resend');
    } finally { setResendLoading(false); }
  }

  async function handleCaptchaSubmit(text) {
    setCaptchaLoading(true); setCaptchaError('');
    try {
      await submitCaptcha(sessionId, text);
      setCaptchaSent(true); setCaptchaRequired(false);
    } catch (err) {
      setCaptchaError(err.response?.data?.error || err.message);
    } finally { setCaptchaLoading(false); }
  }

  async function handleSubmit() {
    setSubmitLoading(true); setError(null);
    try { await submitJob(sessionId); }
    catch (err) { setError(err.response?.data?.error || err.message); setSubmitLoading(false); }
  }

  function handleSkip() {
    clearInterval(pollRef.current);
    // Terminate the backend job if one is active
    if (sessionId) markManual(sessionId).catch(() => {});
    setStatus('skipped');
    onSkip();
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── AWS SSO Expired Banner ────────────────────────────────── */}
      {ssoExpired && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800">AWS SSO Session Expired</p>
            <p className="text-xs text-red-700 mt-0.5 mb-2">
              The AI CAPTCHA solver can't access S3 because your AWS credentials have expired (they refresh every 6–24 hours).
              CAPTCHA has fallen back to manual input. To restore auto-solve, run this command in your terminal:
            </p>
            <code className="block bg-red-100 border border-red-200 rounded-lg px-3 py-2 text-xs font-mono text-red-900 select-all">
              aws sso login --profile Cars24NonprodYogeshMishra
            </code>
            <p className="text-[11px] text-red-500 mt-1.5">Takes ~10 seconds · A browser tab will open · Click "Allow" · Done</p>
          </div>
          <button
            onClick={() => setSsoExpired(false)}
            className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0 mt-0.5"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── IDLE ─────────────────────────────────────────────────── */}
      {status === 'idle' && (
        shouldStart ? (
          /* About to auto-start — brief spinner */
          <div className="text-center py-16">
            <div className="flex items-center justify-center gap-2 text-slate-400">
              <Spinner cls="w-4 h-4 text-[#4736FE]/60" />
              <span className="text-sm">Starting automation for <strong className="text-slate-600">{label}</strong>…</span>
            </div>
          </div>
        ) : (
          /* Waiting for user to choose — card layout matching design spec */
          <div className="flex flex-col items-center py-8 px-4">
            {/* Title */}
            <h2 className="text-[22px] font-bold text-slate-900 mb-1">{label}</h2>
            <p className="text-sm text-slate-500 mb-8">Choose how you want to run automation for this portal.</p>

            {/* Cards row */}
            <div className="w-full max-w-3xl grid grid-cols-2 gap-5">

              {/* ── Single site card ── */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col p-6 gap-5">
                {/* Card header */}
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#EEF0FF' }}>
                    <svg className="w-5 h-5" style={{ color: '#4736FE' }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <polygon points="6,3 20,12 6,21" fill="currentColor" stroke="none" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[15px] font-bold leading-snug" style={{ color: '#4736FE' }}>Start Automation</p>
                    <p className="text-[15px] font-bold leading-snug" style={{ color: '#4736FE' }}>for {label}</p>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">Run automation only for {label} portal.</p>
                  </div>
                </div>

                {/* Features */}
                <ul className="space-y-2.5 flex-1">
                  {['Data and tasks limited to this portal', 'Faster execution', 'Independent control'].map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-slate-500">
                      <svg className="w-4 h-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="9" />
                        <path strokeLinecap="round" d="M9 12h6" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  onClick={onStartSingle}
                  className="w-full rounded-xl py-3.5 flex flex-col items-center gap-0.5 text-white font-semibold text-sm transition hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: '#4736FE' }}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21" /></svg>
                    Start Automation
                  </span>
                  <span className="text-[11px] font-normal opacity-70">Only for {label}</span>
                </button>
              </div>

              {/* ── Complete automation card ── */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col p-6 gap-5">
                {/* Card header */}
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-emerald-50">
                    <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-emerald-700 leading-snug">Start Complete</p>
                    <p className="text-[15px] font-bold text-emerald-700 leading-snug">Automation</p>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      Run automation for all portals, including all cities and states (including Kerala).
                    </p>
                  </div>
                </div>

                {/* Features */}
                <ul className="space-y-2.5 flex-1">
                  {['Includes all portals', 'Comprehensive execution', 'Centralized progress tracking'].map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-slate-500">
                      <svg className="w-4 h-4 flex-shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  onClick={onStartComplete}
                  className="w-full rounded-xl py-3.5 flex flex-col items-center gap-0.5 text-white font-semibold text-sm bg-emerald-600 hover:bg-emerald-700 transition active:scale-[0.98]"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                    Start Complete Automation
                  </span>
                  <span className="text-[11px] font-normal opacity-70">All portals including Kerala</span>
                </button>
              </div>
            </div>

            {/* Info bar */}
            <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              You can stop any automation anytime from the dashboard.
            </div>

            {/* Feature pills */}
            <div className="mt-6 flex flex-wrap justify-center gap-6">
              {[
                { emoji: '😊', title: 'User Friendly',  sub: 'Simple choices, clear actions' },
                { emoji: '⚡', title: 'Flexible',        sub: 'Run single portal or all portals' },
                { emoji: '🛡️', title: 'Control',         sub: 'Stop anytime, full transparency' },
                { emoji: '✅', title: 'Reliable',        sub: 'Secure & uninterrupted automation' },
              ].map(p => (
                <div key={p.title} className="flex items-center gap-2">
                  <span className="text-base">{p.emoji}</span>
                  <div>
                    <p className="text-xs font-semibold text-slate-700 leading-none">{p.title}</p>
                    <p className="text-[11px] text-slate-400 leading-none mt-0.5">{p.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Skip link */}
            {isAutomationActive && (
              <button onClick={handleSkip} className="mt-5 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
                Skip this site
              </button>
            )}
          </div>
        )
      )}

      {/* ── QUEUED — waiting for worker to pick up ───────────────── */}
      {status === 'queued' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-semibold text-slate-700">{label}</span>
            </div>
            <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              Queued
            </span>
          </div>
          <p className="text-xs text-slate-400">Waiting for worker to pick up the job…</p>
        </div>
      )}

      {/* ── RUNNING ──────────────────────────────────────────────── */}
      {status === 'running' && (
        <div className="space-y-4">
          {/* Site label + End Automation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#4736FE] animate-pulse" />
              <span className="text-sm font-semibold text-slate-700">{label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-[#4736FE] bg-[#EEF0FF] px-2 py-0.5 rounded-full">
                Running
              </span>
              <button
                onClick={handleSkip}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-lg transition active:scale-[0.98]"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
                Skip
              </button>
              {isAutomationActive && (
                <button
                  onClick={onEndAutomation}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-white px-3 py-1 rounded-lg transition hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: '#4736FE' }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  End Automation
                </button>
              )}
            </div>
          </div>

          <ProgressBar value={progress} />

          {/* OTP */}
          {otpRequired && !otpSent && (
            <OtpCard
              site={otpSite}
              onSubmit={handleOtpSubmit}
              loading={otpLoading}
              error={otpError}
              resendLoading={resendLoading}
              resendMsg={resendMsg}
              onResend={handleResendOtp}
            />
          )}
          {otpSent && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <CheckCircle />
              OTP submitted — processing…
            </div>
          )}

          {/* CAPTCHA */}
          {captchaRequired && !captchaSent && (
            <CaptchaCard
              label={label}
              image={captchaImage}
              onSubmit={handleCaptchaSubmit}
              loading={captchaLoading}
              error={captchaError}
            />
          )}
          {captchaSent && !captchaRequired && (
            <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
              <CheckCircle />
              CAPTCHA submitted — verifying…
            </div>
          )}

          <LogTerminal logs={logs} logEndRef={logEndRef} />
        </div>
      )}

      {/* ── DONE — no challans ───────────────────────────────────── */}
      {status === 'done' && rows.length === 0 && (
        <div className="py-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">No Challans Found</p>
            <p className="text-xs text-slate-400 mt-1">
              No pending challans for this vehicle on <span className="font-medium">{label}</span>
            </p>
          </div>
          <LogTerminal logs={logs} logEndRef={logEndRef} collapsed />
        </div>
      )}

      {/* ── DONE — challans found ─────────────────────────────────── */}
      {status === 'done' && rows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">{label}</p>
            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
              {rows.length} challan{rows.length > 1 ? 's' : ''} found
            </span>
          </div>
          <LogTerminal logs={logs} logEndRef={logEndRef} collapsed />
          <ChallanTable
            rows={rows}
            sessionId={sessionId}
            onSubmit={handleSubmit}
            onSkip={handleSkip}
            submitLoading={submitLoading}
            submitted={false}
          />
        </div>
      )}

      {/* ── SUBMITTING ───────────────────────────────────────────── */}
      {status === 'submitting' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-[#4736FE] bg-[#EEF0FF] border border-[#4736FE]/20 rounded-xl px-4 py-3">
            <Spinner cls="w-4 h-4 text-[#4736FE]" />
            Submitting challans to admin panel…
          </div>
          <LogTerminal logs={logs} logEndRef={logEndRef} />
        </div>
      )}

      {/* ── SUBMITTED ───────────────────────────────────────────── */}
      {status === 'submitted' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle />
            {rows.length} challan(s) submitted to Admin Panel from {label}
          </div>
          <ChallanTable rows={rows} submitted submitResults={submitResult} />
        </div>
      )}

      {/* ── SKIPPED ─────────────────────────────────────────────── */}
      {status === 'skipped' && (
        <div className="py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-amber-700">Skipped — {label}</p>
          <button onClick={() => { retryCountRef.current = 0; completedRef.current = false; setStatus('idle'); }}
            className="mt-3 text-xs text-[#4736FE] hover:text-[#3526EE] underline underline-offset-2">
            Run again
          </button>
        </div>
      )}

      {/* ── MANUAL INTERVENTION REQUIRED ────────────────────────── */}
      {status === 'manual' && (
        <div className="py-8 space-y-4">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Manual Intervention Required</p>
              <p className="text-xs text-amber-700 mt-1">{error || `${label} could not be reached after multiple attempts. Please check it manually.`}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { retryCountRef.current = 0; autoRetryRef.current = 0; completedRef.current = false; setError(null); setStatus('idle'); }}
              className="flex-1 bg-[#4736FE] hover:bg-[#3526EE] text-white rounded-lg py-2 text-xs font-semibold transition">
              Try Again
            </button>
          </div>
          {logs.length > 0 && <LogTerminal logs={logs} logEndRef={logEndRef} collapsed />}
        </div>
      )}

      {/* ── ERROR ───────────────────────────────────────────────── */}
      {status === 'error' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Automation failed</p>
                <p className="text-xs text-red-600 mt-1 break-words leading-relaxed">{error}</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleRetry}
                className="flex-1 bg-[#4736FE] hover:bg-[#3526EE] text-white rounded-lg py-2 text-xs font-semibold transition">
                Retry
              </button>
              <button onClick={handleSkip}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2 text-xs font-semibold transition">
                Skip this site
              </button>
            </div>
          </div>

          {logs.length > 0 && (
            <LogTerminal logs={logs} logEndRef={logEndRef} collapsed />
          )}
        </div>
      )}
    </div>
  );
}
