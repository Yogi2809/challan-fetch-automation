import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { config } from './config.js';
import createJobRoutes from './routes/jobs.js';
import { requireAuth } from './middleware/auth.js';
import { startWorkerPool } from './queue/workerPool.js';
import { JobRecord } from './models/JobRecord.js';
import { otpResolvers, captchaResolvers } from './utils/sessionStore.js';
import { challanQueue } from './queue/challanQueue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = createServer(app);
const io     = new SocketIO(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve built frontend when running in production (Railway)
const frontendDist = join(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// ── Admin: clear queue ────────────────────────────────────────────────────────
app.post('/api/admin/queue/clear', requireAuth, async (_req, res) => {
  try {
    // Kill every active job
    const active = await challanQueue.getActive();
    await Promise.all(
      active.map(job => job.moveToFailed(new Error('Manually cleared by admin'), '0', true).catch(() => {}))
    );
    // Drain waiting + delayed
    await challanQueue.drain(true);
    const counts = await challanQueue.getJobCounts();
    res.json({ ok: true, killed: active.length, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Routes need io — registered after io is created
app.use('/api/job', requireAuth, createJobRoutes(io));

io.on('connection', (socket) => {
  socket.on('join', async ({ sessionId }) => {
    socket.join(sessionId);
    console.log(`[Socket] ${socket.id} joined room ${sessionId}`);

    // Replay current job state so late-joining clients catch up immediately
    try {
      const job = await JobRecord.findOne({ sessionId });
      if (!job) return;

      // Always send current progress
      socket.emit('progress', { percent: job.progress || 0 });

      // Replay all logs
      for (const log of (job.logs || [])) {
        socket.emit('status', { msg: log.msg });
      }

      // If job is waiting for OTP, re-trigger the OTP box
      if (job.status === 'otp_pending' || otpResolvers.has(sessionId)) {
        socket.emit('otp_required', { sessionId, site: job.otpSite || 'Unknown Site' });
      }

      // If job is waiting for CAPTCHA, re-trigger the CAPTCHA box
      // (image can't be replayed but showing the box lets operator know to wait for new one)
      if (job.status === 'captcha_pending' || captchaResolvers.has(sessionId)) {
        socket.emit('captcha_required', { sessionId, image: '' });
      }

      // If job is already done, re-emit done
      if (job.status === 'done') {
        socket.emit('done', { scrapedRows: job.challanRows || [], posted: [] });
      }

      // If job failed, re-emit error
      if (job.status === 'failed') {
        socket.emit('error', { message: job.error || 'Job failed' });
      }
    } catch (_) {}
  });
});

// SPA fallback — must be after all API routes
if (existsSync(frontendDist)) {
  app.get('*', (_req, res) => res.sendFile(join(frontendDist, 'index.html')));
}

async function bootstrap() {
  await mongoose.connect(config.mongoUri);
  console.log('[MongoDB] Connected');
  await startWorkerPool(io);
  console.log('[Worker] Pool started');
  server.listen(config.port, () => {
    console.log(`[Server] Listening on port ${config.port}`);
  });
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal:', err);
  process.exit(1);
});
