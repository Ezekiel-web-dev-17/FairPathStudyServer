import { Queue, Worker } from 'bullmq';
import { REDIS_URL } from './config.js';
import { runCleanupProcess } from '../scripts/cleanupInactiveUsers.js';
import logger from '../utils/logger.js';

// The Redis connection configuration for BullMQ
const connection = {
  url: REDIS_URL,
};

// Create the cleanup queue
export const cleanupQueue = new Queue('cleanup-queue', { connection });

/**
 * Initializes and schedules the repeatable daily cleanup job.
 * Schedules the job to run daily at 2:00 AM (CRON: '0 2 * * *').
 */
export const initScheduler = async (): Promise<void> => {
  try {
    logger.info('Initializing BullMQ Cleanup Scheduler...');

    // Define a unique repeatable job key
    const jobId = 'daily-inactive-cleanup';

    // Remove any legacy/modified versions of this repeatable job to prevent duplicates
    const activeRepeatableJobs = await cleanupQueue.getRepeatableJobs();
    for (const job of activeRepeatableJobs) {
      if (job.key.includes(jobId)) {
        await cleanupQueue.removeRepeatableByKey(job.key);
        logger.info(`Removed legacy repeatable scheduler job: ${job.key}`);
      }
    }

    // Schedule the repeatable daily cleanup job at 2:00 AM daily
    await cleanupQueue.add(
      'run-inactive-cleanup',
      {},
      {
        jobId,
        repeat: {
          pattern: '0 2 * * *', // Run daily at 2:00 AM
        },
        removeOnComplete: true, // Auto-cleanup job history to save Redis space
        removeOnFail: 100, // Retain last 100 failures for debugging
      }
    );

    logger.info('✅ BullMQ repeatable daily cleanup job scheduled successfully for 2:00 AM.');
  } catch (error) {
    logger.error('Failed to initialize BullMQ Scheduler:', error);
  }
};

/**
 * Worker to process the cleanup job.
 * This runs in the server process to consume scheduled tasks.
 */
export const cleanupWorker = new Worker(
  'cleanup-queue',
  async (job) => {
    logger.info(`[Scheduler Worker] Processing scheduled job: ${job.name}`);
    if (job.name === 'run-inactive-cleanup') {
      await runCleanupProcess();
      logger.info('[Scheduler Worker] Scheduled cleanup completed successfully.');
    }
  },
  {
    connection,
    concurrency: 2, // Only 1 worker executing cleanup at a time
  }
);

cleanupWorker.on('failed', (job, err) => {
  logger.error(`[Scheduler Worker] Job ${job?.id} failed with error:`, err);
});
