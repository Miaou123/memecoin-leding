import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { liquidationJob } from './liquidation.job.js';
import { priceMonitorJob } from './price-monitor.job.js';
import { syncJob } from './sync.job.js';
import { notificationJob } from './notification.job.js';
import { distributionCrankJob } from './distribution-crank.job.js';

// BullMQ requires maxRetriesPerRequest: null for blocking operations
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

// Job queues
export const liquidationQueue = new Queue('liquidation', { connection: redis });
export const priceMonitorQueue = new Queue('price-monitor', { connection: redis });
export const syncQueue = new Queue('sync', { connection: redis });
export const notificationQueue = new Queue('notification', { connection: redis });
export const distributionCrankQueue = new Queue('distribution-crank', { connection: redis });

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

const distributionCrankWorker = new Worker('distribution-crank', distributionCrankJob, {
  connection: redis,
  concurrency: 1,
});

/**
 * Gracefully clean up and re-register repeatable jobs for a queue
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
  const existingRepeatables = await queue.getRepeatableJobs();
  
  for (const job of existingRepeatables) {
    try {
      await queue.removeRepeatableByKey(job.key);
    } catch (err) {
      console.warn(`Could not remove repeatable job ${job.key}:`, err);
    }
  }
  
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
 * Initialize all background jobs
 */
export async function initializeJobs() {
  try {
    console.log('🔄 Initializing background jobs...');
    
    // Liquidation checks (5s backup)
    await setupRepeatableJobs(liquidationQueue, [
      { name: 'check-liquidations', data: {}, every: 5000 },
    ]);
    
    // Price monitoring (3s)
    await setupRepeatableJobs(priceMonitorQueue, [
      { name: 'update-prices', data: {}, every: 3000 },
      { name: 'check-price-alerts', data: {}, every: 15000 },
    ]);
    
    // Sync jobs
    await setupRepeatableJobs(syncQueue, [
      { name: 'sync-protocol-state', data: {}, every: 120000 },
      { name: 'sync-loans', data: {}, every: 60000 },
    ]);
    
    // Notifications
    await setupRepeatableJobs(notificationQueue, [
      { name: 'check-due-notifications', data: {}, every: 60000 },
    ]);
    
    // Distribution crank (30s)
    await setupRepeatableJobs(distributionCrankQueue, [
      { name: 'distribution-tick', data: {}, every: 30000 },
    ]);
    
    // Error handlers
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
    
    distributionCrankWorker.on('failed', (job, err) => {
      console.error(`❌ Distribution crank job failed:`, job?.name, err.message);
    });
    
    // Log active counts
    const [liquidationActive, priceActive, syncActive, notificationActive, distributionActive] = await Promise.all([
      liquidationQueue.getActiveCount(),
      priceMonitorQueue.getActiveCount(),
      syncQueue.getActiveCount(),
      notificationQueue.getActiveCount(),
      distributionCrankQueue.getActiveCount(),
    ]);
    
    const totalActive = liquidationActive + priceActive + syncActive + notificationActive + distributionActive;
    if (totalActive > 0) {
      console.log(`📋 Active jobs: liquidation=${liquidationActive}, price=${priceActive}, sync=${syncActive}, notification=${notificationActive}, distribution=${distributionActive}`);
    }
    
    console.log('✅ Background jobs initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize jobs:', error);
    throw error;
  }
}

/**
 * Graceful shutdown
 */
export async function closeJobs() {
  console.log('🛑 Closing background job workers...');
  
  await Promise.all([
    liquidationWorker.close(),
    priceMonitorWorker.close(),
    syncWorker.close(),
    notificationWorker.close(),
    distributionCrankWorker.close(),
  ]);
  
  await Promise.all([
    liquidationQueue.close(),
    priceMonitorQueue.close(),
    syncQueue.close(),
    notificationQueue.close(),
    distributionCrankQueue.close(),
  ]);
  
  await redis.quit();
  
  console.log('✅ Background jobs closed');
}