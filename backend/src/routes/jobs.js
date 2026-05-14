import { Router }    from 'express';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { challanQueue }                from '../queue/challanQueue.js';
import { JobRecord }                   from '../models/JobRecord.js';
import { otpResolvers, captchaResolvers, resendHandlers, terminateSession } from '../utils/sessionStore.js';
import { getVehicleDetails }           from '../services/omsService.js';
import { deduplicateAndPost }          from '../worker/steps/deduplicatePost.js';
import { SCRAPERS }                    from '../worker/scrapers/registry.js';
import { getOffenceMap }               from '../utils/offenceMap.js';
import { IMAGE_DIR }                   from '../worker/automation.js';
import { maskVehicle, maskJobRecord }  from '../utils/maskResponse.js';

// ── Factory — routes need access to io for socket events ──────────
export default function createJobRoutes(io) {
  const router = Router();

  // ── Lookup vehicle details (no job started) ───────────────────
  router.get('/appointment/:appointmentId', async (req, res) => {
    try {
      const vehicle = await getVehicleDetails(req.params.appointmentId);
      res.json(maskVehicle(vehicle));
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ── List available scrapers (for UI tab building) ─────────────
  router.get('/scrapers', (_req, res) => {
    res.json(SCRAPERS.map(s => ({
      id:          s.id,
      label:       s.label,
      challanCourt: s.CHALLAN_COURT,
      requiresOtp:     s.requiresOtp,
      requiresCaptcha: s.requiresCaptcha ?? false,
      isManual:        s.isManual        ?? false,
    })));
  });

  // ── Start a single-scraper job ────────────────────────────────
  router.post('/start', async (req, res) => {
    const {
      appointmentId, mobileNumber, createdBy, scraperId,
      registrationNumber, chassisNumber, engineNumber,
    } = req.body;

    if (!mobileNumber) {
      return res.status(400).json({ error: 'mobileNumber is required' });
    }
    if (!scraperId) {
      return res.status(400).json({ error: 'scraperId is required' });
    }

    const sessionId    = uuidv4();
    const jobCreatedBy = createdBy || 'yogesh.mishra@cars24.com';
    const apptId       = appointmentId?.trim() || '';

    try {
      // Create DB record BEFORE responding so the frontend can poll immediately
      await JobRecord.create({
        sessionId, appointmentId: apptId, mobileNumber,
        createdBy: jobCreatedBy, scraperId, status: 'queued',
      });
      await challanQueue.add('fetch-challans', {
        sessionId, appointmentId: apptId, mobileNumber,
        createdBy: jobCreatedBy, scraperId,
        registrationNumber, chassisNumber, engineNumber,
      });
      res.json({ sessionId });
    } catch (err) {
      console.error('[start] Failed to create job:', err.message);
      res.status(500).json({ error: 'Failed to start job: ' + err.message });
    }
  });

  // ── Submit scraped challans to admin panel ────────────────────
  router.post('/:sessionId/submit', async (req, res) => {
    const { sessionId } = req.params;
    const job = await JobRecord.findOne({ sessionId }).catch(() => null);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['done', 'submitted', 'submitting'].includes(job.status)) {
      return res.status(400).json({ error: `Job is in "${job.status}" state, not done` });
    }

    res.json({ ok: true }); // respond immediately — work runs in background

    function emitStatus(msg) {
      io.to(sessionId).emit('status', { msg });
      JobRecord.findOneAndUpdate(
        { sessionId },
        { $push: { logs: { ts: new Date(), msg } } }
      ).catch(() => {});
    }

    try {
      await JobRecord.findOneAndUpdate({ sessionId }, { status: 'submitting' });
      io.to(sessionId).emit('submit_started', { sessionId });

      // Reattach imageBuffer from disk (saved during scraping).
      // Always prefer .jpg; fall back to legacy .png for sessions scraped before this fix.
      const scrapedRows = (job.challanRows || []).map(r => {
        const imgPathJpg = path.join(IMAGE_DIR, `${sessionId}-${r.noticeNo}.jpg`);
        const imgPathPng = path.join(IMAGE_DIR, `${sessionId}-${r.noticeNo}.png`);
        const imgPath = existsSync(imgPathJpg) ? imgPathJpg : imgPathPng;
        let imageBuffer = null;
        try { if (existsSync(imgPath)) imageBuffer = readFileSync(imgPath); } catch (_) {}
        return { ...r.toObject(), imageBuffer };
      });

      const posted = await deduplicateAndPost({
        appointmentId: job.appointmentId,
        sessionId,
        createdBy:     job.createdBy,
        scrapedRows,
        offenceLookupMap: getOffenceMap(),
        emitStatus,
      });

      await JobRecord.findOneAndUpdate({ sessionId }, { status: 'submitted' });
      io.to(sessionId).emit('submit_done', { posted });

    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      emitStatus(`Submit error: ${msg}`);
      await JobRecord.findOneAndUpdate({ sessionId }, { status: 'done' }); // revert so user can retry
      io.to(sessionId).emit('submit_error', { message: msg });
    }
  });

  // ── Resend OTP (triggers resendOtp() on the Playwright page) ─
  router.post('/:sessionId/resend-otp', async (req, res) => {
    const { sessionId } = req.params;
    const handler = resendHandlers.get(sessionId);
    if (!handler) return res.status(404).json({ error: 'No resend handler for this session — OTP step may not be active' });
    try {
      const msg = await handler();
      res.json({ ok: true, message: msg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── CAPTCHA submission ────────────────────────────────────────
  router.post('/:sessionId/captcha', (req, res) => {
    const { sessionId } = req.params;
    const { captchaText } = req.body;
    if (!captchaText) return res.status(400).json({ error: 'captchaText is required' });
    const resolve = captchaResolvers.get(sessionId);
    if (!resolve) return res.status(404).json({ error: 'No captcha waiter for this session' });
    resolve(captchaText);
    res.json({ ok: true });
  });

  // ── OTP submission ────────────────────────────────────────────
  router.post('/:sessionId/otp', (req, res) => {
    const { sessionId } = req.params;
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'otp is required' });
    const resolve = otpResolvers.get(sessionId);
    if (!resolve) return res.status(404).json({ error: 'No OTP waiter found for this session' });
    resolve(otp);
    res.json({ ok: true });
  });

  // ── Get job status ────────────────────────────────────────────
  router.get('/:sessionId', async (req, res) => {
    try {
      const job = await JobRecord.findOne({ sessionId: req.params.sessionId });
      if (!job) return res.status(404).json({ error: 'Job not found' });
      res.json(maskJobRecord(job));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Reassign (retry) job ──────────────────────────────────────
  router.post('/:sessionId/reassign', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const job = await JobRecord.findOne({ sessionId });
      if (!job) return res.status(404).json({ error: 'Job not found' });
      await terminateSession(sessionId);
      const newSessionId = uuidv4();
      await JobRecord.create({
        sessionId:     newSessionId,
        appointmentId: job.appointmentId,
        mobileNumber:  job.mobileNumber,
        createdBy:     req.body.newCreatedBy || job.createdBy,
        scraperId:     job.scraperId,
        status: 'queued',
      });
      await challanQueue.add('fetch-challans', {
        sessionId:     newSessionId,
        appointmentId: job.appointmentId,
        mobileNumber:  job.mobileNumber,
        createdBy:     req.body.newCreatedBy || job.createdBy,
        scraperId:     job.scraperId,
      });
      res.json({ newSessionId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Mark manual ───────────────────────────────────────────────
  router.post('/:sessionId/manual', async (req, res) => {
    try {
      await terminateSession(req.params.sessionId);
      await JobRecord.findOneAndUpdate({ sessionId: req.params.sessionId }, { status: 'manual' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
