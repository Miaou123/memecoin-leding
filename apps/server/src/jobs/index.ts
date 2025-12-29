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

// Job schedules
export async function initializeJobs() {
  try {
    // Clear existing jobs
    await liquidationQueue.obliterate();
    await priceMonitorQueue.obliterate();
    await syncQueue.obliterate();
    
    // Schedule recurring jobs
    
    // Liquidation check every 30 seconds
    await liquidationQueue.add(
      'check-liquidations',
      {},
      {
        repeat: { every: 30000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
    
    // Price monitoring every 10 seconds
    await priceMonitorQueue.add(
      'update-prices',
      {},
      {
        repeat: { every: 10000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
    
    // Price alerts every 30 seconds
    await priceMonitorQueue.add(
      'check-price-alerts',
      {},
      {
        repeat: { every: 30000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
    
    // Sync on-chain data every 2 minutes
    await syncQueue.add(
      'sync-protocol-state',
      {},
      {
        repeat: { every: 120000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
    
    await syncQueue.add(
      'sync-loans',
      {},
      {
        repeat: { every: 60000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
    
    // Due notifications every minute
    await notificationQueue.add(
      'check-due-notifications',
      {},
      {
        repeat: { every: 60000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
    
    console.log('✅ Jobs initialized successfully');
    
    // Setup error handlers
    liquidationWorker.on('failed', (job, err) => {
      console.error(`Liquidation job failed:`, job?.data, err);
    });
    
    priceMonitorWorker.on('failed', (job, err) => {
      console.error(`Price monitor job failed:`, job?.data, err);
    });
    
    syncWorker.on('failed', (job, err) => {
      console.error(`Sync job failed:`, job?.data, err);
    });
    
    notificationWorker.on('failed', (job, err) => {
      console.error(`Notification job failed:`, job?.data, err);
    });
    
  } catch (error) {
    console.error('Failed to initialize jobs:', error);
    throw error;
  }
}

// Graceful shutdown
export async function closeJobs() {
  await Promise.all([
    liquidationWorker.close(),
    priceMonitorWorker.close(),
    syncWorker.close(),
    notificationWorker.close(),
  ]);
}
