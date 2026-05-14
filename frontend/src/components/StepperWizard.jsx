import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { getJobStatus } from '../api.js';
import Step1_AppointmentId from './Step1_AppointmentId.jsx';
import Step3_OtpAndStatus from './Step3_OtpAndStatus.jsx';
import Step4_Results from './Step4_Results.jsx';

const STEPS = ['Appointment', 'OTP & Status', 'Results'];

export default function StepperWizard() {
  const [step, setStep]               = useState(0);
  const [sessionId, setSessionId]     = useState(null);
  const [logs, setLogs]               = useState([]);
  const [progress, setProgress]       = useState(0);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpSite, setOtpSite]         = useState('');   // which scraper is asking
  const [otpSent, setOtpSent]         = useState(false); // lifted so parent can reset it
  const [results, setResults]         = useState(null);
  const [jobError, setJobError]       = useState(null);
  const seenLogs                      = useRef(new Set());
  const pollRef                       = useRef(null);
  const doneRef                       = useRef(false);

  function addLog(msg) {
    if (!msg || seenLogs.current.has(msg)) return;
    seenLogs.current.add(msg);
    setLogs(l => [...l, msg]);
  }

  // ── REST polling — primary source of truth ────────────────────────────
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

        if (job.status === 'otp_pending') {
          setOtpRequired(true);
          setOtpSite(job.otpSite || '');
          setOtpSent(false);   // reset so box re-appears for each new OTP request
          setJobError(null);
        }
        if (job.status === 'done') {
          doneRef.current = true;
          clearInterval(pollRef.current);
          setResults({ scrapedRows: job.challanRows || [] });
          setStep(2);
        }
        if (job.status === 'failed') {
          doneRef.current = true;
          clearInterval(pollRef.current);
          setJobError(job.error || 'Automation failed');
        }
      } catch (_) {}
    }

    poll(); // immediate first poll
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [sessionId]);

  // ── Socket — for real-time speed on top of polling ───────────────────
  const handlers = {
    onStatus:      useCallback(({ msg }) => addLog(msg), []),
    onProgress:    useCallback(({ percent }) => setProgress(percent), []),
    onOtpRequired: useCallback(({ site } = {}) => {
      setOtpRequired(true);
      setOtpSite(site || '');
      setOtpSent(false);   // always reset — each scraper is a fresh OTP request
      setJobError(null);
    }, []),
    onDone:        useCallback((data) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearInterval(pollRef.current);
      setResults(data);
      setStep(2);
    }, []),
    onError:       useCallback(({ message }) => setJobError(message), []),
  };
  useSocket(sessionId, handlers);

  function handleJobStarted(sid) {
    seenLogs.current = new Set();
    setLogs([]);
    setProgress(0);
    setOtpRequired(false);
    setOtpSite('');
    setOtpSent(false);
    setJobError(null);
    setResults(null);
    doneRef.current = false;
    setSessionId(sid);
    setStep(1);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      {/* Step indicator */}
      <div className="flex items-center mb-8">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-xs mt-1 text-gray-500">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {step === 0 && <Step1_AppointmentId onJobStarted={handleJobStarted} />}
      {step === 1 && (
        <Step3_OtpAndStatus
          sessionId={sessionId}
          logs={logs}
          progress={progress}
          otpRequired={otpRequired}
          otpSite={otpSite}
          otpSent={otpSent}
          onOtpSent={() => setOtpSent(true)}
          jobError={jobError}
        />
      )}
      {step === 2 && <Step4_Results results={results} sessionId={sessionId} />}
    </div>
  );
}
