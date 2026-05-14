import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';

const redisConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const challanQueue = new Queue('challan-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,           // No auto-retry — each run needs fresh CAPTCHA/OTP input
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
