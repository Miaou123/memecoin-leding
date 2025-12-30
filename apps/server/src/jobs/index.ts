import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { liquidationJob } from './liquidation.job.js';
import { priceMonitorJob } from './price-monitor.job.js';
import { syncJob } from './sync.job.js';
import { notificationJob } from './notification.job.js';

// BullMQ requires maxRetriesPerRequest: null for blocking operations
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

// Job queues
export const liquidationQueue = new Queue('liquidation', { connection: redis });
export const priceMonitorQueue = new Queue('price-monitor', { connection: redis });
export const syncQueue = new Queue('sync', { connection: redis });
export const notificationQueue = new Queue('notification', { connection: redis });

// Job workers
const liquidationWorker = new Worker('liquidation', liquidationJob, { 
  connection: redis,
  concurrency: 1,
});

const priceMonitorWorker = new Worker('price-monitor', priceMonitorJob, {
  connection: redis,
  concurrency: 1,
});

const syncWorker = new Worker('sync', syncJob, {
  connection: redis,
  concurrency: 1,
});

const notificationWorker = new Worker('notification', notificationJob, {
  connection: redis,
  concurrency: 5,
});

/**
 * Gracefully clean up and re-register repeatable jobs for a queue
 * This removes old repeatable job configurations without affecting active jobs
 */
async function setupRepeatableJobs(
  queue: Queue,
  jobs: Array<{
    name: string;
    data: Record<string, any>;
    every: number;
    removeOnComplete?: number;
    removeOnFail?: number;
  }>
) {
  // Get existing repeatable jobs
  const existingRepeatables = await queue.getRepeatableJobs();
  
  // Remove all existing repeatable job configurations
  for (const job of existingRepeatables) {
    try {
      await queue.removeRepeatableByKey(job.key);
    } catch (err) {
      console.warn(`Could not remove repeatable job ${job.key}:`, err);
    }
  }
  
  // Add fresh repeatable jobs
  for (const job of jobs) {
    await queue.add(
      job.name,
      job.data,
      {
        repeat: { every: job.every },
        removeOnComplete: job.removeOnComplete ?? 5,
        removeOnFail: job.removeOnFail ?? 10,
      }
    );
  }
}

/**
 * Initialize all background jobs gracefully
 * - Cleans up old repeatable configurations
 * - Preserves in-progress jobs
 * - Re-registers all repeatable jobs
 */
export async function initializeJobs() {
  try {
    console.log('🔄 Initializing background jobs...');
    
    // Setup liquidation queue jobs - BACKUP: Liquidation checks (5s backup to fast monitor)
    await setupRepeatableJobs(liquidationQueue, [
      {
        name: 'check-liquidations',
        data: {},
        every: 5000, // Every 5 seconds (backup to fast monitor)
      },
    ]);
    
    // Setup price monitor queue jobs - SECURITY: Fast price monitoring (3s)
    await setupRepeatableJobs(priceMonitorQueue, [
      {
        name: 'update-prices',
        data: {},
        every: 3000, // Every 3 seconds (was 10s)
      },
      {
        name: 'check-price-alerts',
        data: {},
        every: 15000, // Every 15 seconds (reduced from 30s)
      },
    ]);
    
    // Setup sync queue jobs
    await setupRepeatableJobs(syncQueue, [
      {
        name: 'sync-protocol-state',
        data: {},
        every: 120000, // Every 2 minutes
      },
      {
        name: 'sync-loans',
        data: {},
        every: 60000, // Every minute
      },
    ]);
    
    // Setup notification queue jobs
    await setupRepeatableJobs(notificationQueue, [
      {
        name: 'check-due-notifications',
        data: {},
        every: 60000, // Every minute
      },
    ]);
    
    // Setup error handlers
    liquidationWorker.on('failed', (job, err) => {
      console.error(`❌ Liquidation job failed:`, job?.name, err.message);
    });
    
    priceMonitorWorker.on('failed', (job, err) => {
      console.error(`❌ Price monitor job failed:`, job?.name, err.message);
    });
    
    syncWorker.on('failed', (job, err) => {
      console.error(`❌ Sync job failed:`, job?.name, err.message);
    });
    
    notificationWorker.on('failed', (job, err) => {
      console.error(`❌ Notification job failed:`, job?.name, err.message);
    });
    
    // Log active job counts
    const [liquidationActive, priceActive, syncActive, notificationActive] = await Promise.all([
      liquidationQueue.getActiveCount(),
      priceMonitorQueue.getActiveCount(),
      syncQueue.getActiveCount(),
      notificationQueue.getActiveCount(),
    ]);
    
    if (liquidationActive + priceActive + syncActive + notificationActive > 0) {
      console.log(`📋 Preserved active jobs: liquidation=${liquidationActive}, price=${priceActive}, sync=${syncActive}, notification=${notificationActive}`);
    }
    
    console.log('✅ Background jobs initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize jobs:', error);
    throw error;
  }
}

/**
 * Graceful shutdown - close all workers
 */
export async function closeJobs() {
  console.log('🛑 Closing background job workers...');
  
  await Promise.all([
    liquidationWorker.close(),
    priceMonitorWorker.close(),
    syncWorker.close(),
    notificationWorker.close(),
  ]);
  
  // Close queues
  await Promise.all([
    liquidationQueue.close(),
    priceMonitorQueue.close(),
    syncQueue.close(),
    notificationQueue.close(),
  ]);
  
  // Close Redis connection
  await redis.quit();
  
  console.log('✅ Background jobs closed');
}