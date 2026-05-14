import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';
import { runAutomation } from '../worker/automation.js';
import { JobRecord } from '../models/JobRecord.js';

export async function startWorkerPool(io) {
  const redisConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  // Clean up stale jobs from previous server runs so workers don't get blocked
  try {
    const cleanupQueue = new Queue('challan-jobs', { connection: redisConnection });

    // 1. Drain BullMQ queue (remove waiting + delayed)
    await cleanupQueue.drain();

    // 2. Move any active BullMQ jobs to failed
    const active = await cleanupQueue.getActive();
    for (const job of active) {
      await job.moveToFailed({ message: 'Server restarted — stale job discarded' }, '0', true).catch(() => {});
    }
    console.log(`[Worker] Cleared ${active.length} stale BullMQ active job(s) on startup`);

    // 3. Mark any MongoDB records stuck in non-terminal states as "error"
    //    so the frontend stops polling them forever
    const staleStatuses = ['queued', 'running', 'captcha_pending', 'otp_pending'];
    const dbResult = await JobRecord.updateMany(
      { status: { $in: staleStatuses } },
      {
        $set: { status: 'error' },
        $push: { logs: { ts: new Date(), msg: 'Server restarted — stale job automatically cleared' } },
      }
    ).catch(() => ({ modifiedCount: 0 }));
    if (dbResult.modifiedCount > 0) {
      console.log(`[Worker] Marked ${dbResult.modifiedCount} stale MongoDB job(s) as "error" on startup`);
    }

    await cleanupQueue.close();
  } catch (err) {
    console.warn('[Worker] Startup cleanup warning:', err.message);
  }

  const worker = new Worker(
    'challan-jobs',
    async (job) => {
      await runAutomation(job, io);
    },
    {
      connection: redisConnection,
      concurrency: config.workerConcurrency,
      // Lock duration = 15 minutes. The worker renews every lockDuration/2.
      // If the process crashes or hangs, Redis automatically unlocks the job
      // after this window so the next server restart can clean it up.
      lockDuration: 15 * 60 * 1000,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });
  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  return worker;
}
