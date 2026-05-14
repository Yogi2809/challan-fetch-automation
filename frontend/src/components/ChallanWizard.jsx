import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getScrapers, clearQueue } from '../api.js';
import { maskRegNoForUI, maskChassisForUI, maskEngineForUI } from '../utils/vehicleMasking.js';
import AppointmentForm    from './AppointmentForm.jsx';
import ScraperTabPanel    from './ScraperTabPanel.jsx';
import PendingChallansTab from './PendingChallansTab.jsx';

const TAB_STATUS = {
  pending: { dot: 'bg-slate-300' },
  queued:  { dot: 'bg-amber-400 animate-pulse' },
  running: { dot: 'bg-[#4736FE] animate-pulse' },
  done:    { dot: 'bg-emerald-500' },
  error:   { dot: 'bg-red-500' },
  skipped: { dot: 'bg-amber-400' },
  manual:  { dot: 'bg-amber-400' },
};

// ── Progress bar ──────────────────────────────────────────────────────────────
function RunProgress({ scrapers, tabStatuses, allDone, automationMode }) {
  // Complete mode counts all scrapers; single/null counts only sequential
  const relevant = automationMode === 'complete'
    ? scrapers
    : scrapers.filter(s => !s.isManual);

  const doneCount = relevant.filter(s =>
    ['done', 'skipped', 'error', 'manual'].includes(tabStatuses[s.id])
  ).length;
  const pct = relevant.length ? Math.round((doneCount / relevant.length) * 100) : 0;

  if (!automationMode) return null; // don't show progress bar before automation starts

  return (
    <div className="px-8 py-3 border-b border-slate-100">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-500">
          {allDone
            ? `All ${relevant.length} sites checked`
            : automationMode === 'single'
              ? 'Single-site automation running…'
              : `Checking ${relevant.length} sites — ${doneCount} done`}
        </span>
        <span className="text-xs font-semibold text-[#4736FE]">{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-width"
          style={{ width: `${allDone ? 100 : pct}%`, background: 'linear-gradient(to right, #4736FE, #7B73FF)' }}
        />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChallanWizard() {
  const [step,            setStep]            = useState('form');
  const [appointment,     setAppointment]     = useState(null);
  const [scrapers,        setScrapers]        = useState([]);
  const [activeTabId,     setActiveTabId]     = useState(null);
  const [currentRunIndex, setCurrentRunIndex] = useState(-1);
  const [allDone,         setAllDone]         = useState(false);
  const [scraperResults,  setScraperResults]  = useState({});
  const [tabStatuses,     setTabStatuses]     = useState({});
  const [runKey,          setRunKey]          = useState(0);

  // automationMode: null = waiting, 'single' = one site, 'complete' = all sites
  const [automationMode,  setAutomationMode]  = useState(null);
  const [singleTargetId,  setSingleTargetId]  = useState(null);

  // Refs for use inside useCallback closures without stale closure issues
  const automationModeRef  = useRef(null);
  const scrapersRef        = useRef([]);

  useEffect(() => { scrapersRef.current = scrapers; }, [scrapers]);

  // ── Load scraper list ─────────────────────────────────────────────────────
  useEffect(() => {
    getScrapers()
      .then(list => {
        setScrapers(list);
        if (list.length) setActiveTabId(list[0].id);
        const s = {};
        list.forEach(x => { s[x.id] = 'pending'; });
        setTabStatuses(s);
      })
      .catch(() => {
        const fb = [
          { id: 'delhi',     label: 'Delhi Traffic Police',     requiresOtp: true,  requiresCaptcha: false, isManual: false },
          { id: 'mp',        label: 'MP eChallan',              requiresOtp: false, requiresCaptcha: true,  isManual: false },
          { id: 'telangana', label: 'Telangana Police',         requiresOtp: false, requiresCaptcha: true,  isManual: false },
          { id: 'jharkhand', label: 'Jharkhand Traffic Police', requiresOtp: false, requiresCaptcha: true,  isManual: false },
          { id: 'westbengal',label: 'West Bengal (SANJOG)',     requiresOtp: false, requiresCaptcha: false, isManual: false },
          { id: 'kerala',    label: 'Kerala Police',            requiresOtp: false, requiresCaptcha: false, isManual: true  },
        ];
        setScrapers(fb);
        setActiveTabId(fb[0].id);
        const s = {};
        fb.forEach(x => { s[x.id] = 'pending'; });
        setTabStatuses(s);
      });
  }, []);

  // ── After form lookup: show running view, no auto-start ──────────────────
  function handleLookupSuccess(appt) {
    setAppointment(appt);
    setStep('running');
    setAutomationMode(null);
    automationModeRef.current = null;
    setSingleTargetId(null);
    setAllDone(false);
    setScraperResults({});
    setCurrentRunIndex(-1);
    setRunKey(k => k + 1);
    const s = {};
    scrapers.forEach(x => { s[x.id] = 'pending'; });
    setTabStatuses(s);
    if (scrapers.length) setActiveTabId(scrapers[0].id);
  }

  // ── Start single-site automation for one scraper ──────────────────────────
  function handleStartSingle(scraperId) {
    const all = scrapersRef.current;
    automationModeRef.current = 'single';
    setAutomationMode('single');
    setSingleTargetId(scraperId);
    setAllDone(false);
    setScraperResults({});
    setRunKey(k => k + 1);
    const newStatuses = {};
    all.forEach(s => { newStatuses[s.id] = 'pending'; });
    // Mark as running so the tab dot updates immediately
    newStatuses[scraperId] = 'running';
    setTabStatuses(newStatuses);
    // For sequential scrapers, set currentRunIndex so isCurrentRunner fires the auto-start
    const seqScrapers = all.filter(s => !s.isManual);
    const seqIdx = seqScrapers.findIndex(s => s.id === scraperId);
    setCurrentRunIndex(seqIdx >= 0 ? seqIdx : -1);
    setActiveTabId(scraperId);
  }

  // ── Start complete automation (all scrapers in order, including Kerala) ───
  function handleStartComplete() {
    const all = scrapersRef.current;
    automationModeRef.current = 'complete';
    setAutomationMode('complete');
    setSingleTargetId(null);
    setAllDone(false);
    setScraperResults({});
    setRunKey(k => k + 1);
    const newStatuses = {};
    all.forEach(s => { newStatuses[s.id] = 'pending'; });
    // First scraper in the full list starts running
    if (all.length) newStatuses[all[0].id] = 'running';
    setTabStatuses(newStatuses);
    setCurrentRunIndex(0);  // index into `scrapers` for complete mode
    if (all.length) setActiveTabId(all[0].id);
  }

  // ── End automation: stop advancing, leave running jobs to finish naturally ─
  function handleEndAutomation() {
    automationModeRef.current = null;
    setAutomationMode(null);
    setSingleTargetId(null);
    setCurrentRunIndex(-1);
    // Running tabs turn back to pending so they show the buttons again
    setTabStatuses(prev => {
      const next = { ...prev };
      scrapersRef.current.forEach(s => {
        if (next[s.id] === 'running') next[s.id] = 'pending';
      });
      return next;
    });
  }

  // ── Clear BullMQ queue (kills active + drains waiting) ───────────────────
  async function handleClearQueue() {
    try {
      const result = await clearQueue();
      alert(`Queue cleared. Killed ${result.killed} active job(s).`);
    } catch (err) {
      alert(`Failed to clear queue: ${err.response?.data?.error || err.message}`);
    }
  }

  // ── Scraper lifecycle callbacks ───────────────────────────────────────────
  const handleScraperComplete = useCallback((scraperId, rows, sessionId) => {
    setScraperResults(prev => ({ ...prev, [scraperId]: { rows, sessionId } }));
    setTabStatuses(prev => ({ ...prev, [scraperId]: 'done' }));

    // Only advance the sequential runner in complete mode
    if (automationModeRef.current !== 'complete') return;

    setCurrentRunIndex(prev => {
      const all = scrapersRef.current;  // complete mode uses full scrapers array
      const next = prev + 1;
      if (next >= all.length) {
        setAllDone(true);
        setTimeout(() => setActiveTabId('pending-challans'), 300);
      } else {
        const nextScraper = all[next];
        setActiveTabId(nextScraper.id);
        setTabStatuses(ps => ({ ...ps, [nextScraper.id]: 'running' }));
      }
      return next;
    });
  }, []);

  const handleScraperError = useCallback((scraperId) => {
    setTabStatuses(prev => ({ ...prev, [scraperId]: 'error' }));
    // Errors stall the sequence — user must retry or skip manually from the tab
  }, []);

  const handleScraperSkip = useCallback((scraperId) => {
    // Mark as skipped (don't touch scraperResults — no rows)
    setTabStatuses(prev => ({ ...prev, [scraperId]: 'skipped' }));

    // Advance the sequence exactly like a completion, but without overwriting status to 'done'
    if (automationModeRef.current !== 'complete') return;

    setCurrentRunIndex(prev => {
      const all = scrapersRef.current;
      const next = prev + 1;
      if (next >= all.length) {
        setAllDone(true);
        setTimeout(() => setActiveTabId('pending-challans'), 300);
      } else {
        const nextScraper = all[next];
        setActiveTabId(nextScraper.id);
        setTabStatuses(ps => ({ ...ps, [nextScraper.id]: 'running' }));
      }
      return next;
    });
  }, []);

  function handleReset() {
    setAppointment(null);
    setStep('form');
    setAutomationMode(null);
    automationModeRef.current = null;
    setSingleTargetId(null);
    setCurrentRunIndex(-1);
    setAllDone(false);
    setScraperResults({});
    const s = {};
    scrapers.forEach(x => { s[x.id] = 'pending'; });
    setTabStatuses(s);
    if (scrapers.length) setActiveTabId(scrapers[0].id);
  }

  const allChallanRows = scrapers.flatMap(s => {
    const result = scraperResults[s.id];
    if (!result?.rows?.length) return [];
    return result.rows.map(r => ({ ...r, source: s.label, sourceId: s.id, sessionId: result.sessionId }));
  });

  const tabs = [
    ...scrapers,
    ...(allDone ? [{ id: 'pending-challans', label: 'Pending Challans', isPendingTab: true }] : []),
  ];

  const isAutomationActive = !!automationMode;

  // ── FORM STEP — full-screen split layout ──────────────────────────────────
  if (step === 'form') {
    return (
      <div className="h-screen flex overflow-hidden">

        {/* ── Left panel: brand blue + banner illustration ── */}
        <div
          className="hidden lg:flex w-[55%] relative overflow-hidden flex-shrink-0 items-center justify-center"
          style={{ backgroundColor: '#4736FE' }}
        >
          <img
            src="https://onebridge.24c.in/onebridge/viz-panel/login-banner.ff2b690e6c20160f.png"
            alt=""
            className="w-full h-full object-contain"
            onError={e => { e.target.style.display = 'none'; }}
          />
        </div>

        {/* ── Right panel: fully centered logo + form ── */}
        <div className="flex-1 flex items-center justify-center bg-white overflow-hidden px-8">
          <div className="w-full max-w-[400px]">

            {/* Logo */}
            <div className="mb-4 flex justify-center">
              <img
                src="/cars24-logo.png"
                alt="Cars24"
                className="h-20 w-auto"
                style={{
                  filter: 'brightness(0) saturate(100%) invert(22%) sepia(97%) saturate(2000%) hue-rotate(234deg) brightness(103%)',
                }}
              />
            </div>

            {/* Heading */}
            <h1 className="text-[34px] font-bold text-slate-900 tracking-[0.2em] leading-tight mb-1.5 text-center">
              A.C.E
            </h1>
            <p className="text-[14px] text-slate-500 mb-8 leading-relaxed text-center">
              Check pending challans across all traffic portals automatically.
            </p>

            <AppointmentForm onLookupSuccess={handleLookupSuccess} />
          </div>
        </div>
      </div>
    );
  }

  // ── RUNNING STEP — full-screen with top header + tabs ─────────────────────
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">

      {/* Header */}
      <div style={{ backgroundColor: '#4736FE' }} className="flex-shrink-0 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              src="/cars24-logo.png"
              alt="Cars24"
              className="h-7 w-auto object-contain"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
            <div className="w-px h-5 bg-white/25" />
            <div>
              <p className="text-white text-[15px] font-bold uppercase tracking-[0.12em] leading-none">
                ACE
              </p>
              <p className="text-white text-[11px] mt-0.5 font-medium">Multi-portal · Traffic Police</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Clear Queue */}
            <button
              onClick={handleClearQueue}
              className="text-[12px] font-semibold text-white hover:text-white/80 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 border border-white/40"
              title="Kill all active & waiting jobs in the queue"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear Queue
            </button>
            <button
              onClick={handleReset}
              className="text-[12px] font-semibold text-white hover:text-white/80 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 border border-white/40"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              New lookup
            </button>
          </div>
        </div>

        {/* Vehicle chips */}
        {appointment?.vehicle && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { key: 'Reg No',  val: maskRegNoForUI(appointment.vehicle.registrationNumber) },
              { key: 'Chassis', val: maskChassisForUI(appointment.vehicle.chassisNumber) },
              { key: 'Engine',  val: maskEngineForUI(appointment.vehicle.engineNumber) },
              { key: 'Mobile',  val: appointment.mobileNumber },
            ].map(({ key, val }) => (
              <div key={key} className="glass rounded-lg px-3 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.75)' }}>{key}</p>
                <p className="text-white text-[12px] font-semibold font-mono mt-0.5 leading-none tracking-wider">{val}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Progress bar — only visible during active automation */}
      <RunProgress
        scrapers={scrapers}
        tabStatuses={tabStatuses}
        allDone={allDone}
        automationMode={automationMode}
      />

      {/* Tab bar */}
      <div className="border-b border-slate-200 bg-white overflow-x-auto scrollbar-thin flex-shrink-0">
        <div className="flex min-w-max px-4">
          {tabs.map(s => {
            const isPending    = s.isPendingTab;
            const status       = isPending ? (allDone ? 'done' : 'pending') : (tabStatuses[s.id] || 'pending');
            const isActive     = activeTabId === s.id;
            const cfg          = TAB_STATUS[status] || TAB_STATUS.pending;
            const challanCount = isPending
              ? allChallanRows.length
              : (scraperResults[s.id]?.rows?.length ?? 0);

            return (
              <button
                key={s.id}
                onClick={() => setActiveTabId(s.id)}
                className={[
                  'group relative flex items-center gap-2 px-5 py-3.5 text-[13px] font-medium',
                  'border-b-2 transition-all whitespace-nowrap select-none',
                  isActive
                    ? 'border-[#4736FE] text-[#4736FE] bg-[#EEF0FF]/40'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span>{s.label}</span>
                {challanCount > 0 && (
                  <span className={[
                    'ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none',
                    isPending ? 'bg-red-500 text-white' : 'bg-red-100 text-red-600',
                  ].join(' ')}>
                    {challanCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-8">
        {scrapers.map((s, idx) => {
          // shouldStart: true when this tab should auto-start its scraper
          // - complete mode: this tab is the current index in the full scrapers array
          // - single mode: this tab is the selected single target (sequential scrapers use seqIdx, manual use singleTargetId)
          const seqScrapers = scrapers.filter(x => !x.isManual);
          const seqIdx = seqScrapers.findIndex(x => x.id === s.id);
          const shouldStart =
            automationMode === 'complete' ? idx === currentRunIndex :
            automationMode === 'single'   ? (
              s.isManual ? s.id === singleTargetId : seqIdx === currentRunIndex
            ) : false;

          return (
            <div key={s.id} className={activeTabId === s.id ? 'block' : 'hidden'}>
              <ScraperTabPanel
                key={`${s.id}-${runKey}`}
                scraper={s}
                appointment={appointment}
                shouldStart={shouldStart}
                isManual={!!s.isManual}
                isAutomationActive={isAutomationActive}
                onStartSingle={() => handleStartSingle(s.id)}
                onStartComplete={handleStartComplete}
                onEndAutomation={handleEndAutomation}
                onComplete={(rows, sessionId) => handleScraperComplete(s.id, rows, sessionId)}
                onError={() => handleScraperError(s.id)}
                onSkip={() => handleScraperSkip(s.id)}
              />
            </div>
          );
        })}

        {activeTabId === 'pending-challans' && (
          <PendingChallansTab
            rows={allChallanRows}
            scrapers={scrapers}
            scraperResults={scraperResults}
            tabStatuses={tabStatuses}
          />
        )}
      </div>
    </div>
  );
}
