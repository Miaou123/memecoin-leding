import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { liquidationJob } from './liquidation.job.js';
import { priceMonitorJob } from './price-monitor.job.js';
import { syncJob } from './sync.job.js';
import { notificationJob } from './notification.job.js';
import { distributionCrankJob } from './distribution-crank.job.js';
import { dailySummaryJob } from './daily-summary.job.js';
import { scheduleLPMonitoring } from './lp-monitor.job.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { liquidatorMetrics } from '../services/liquidator-metrics.service.js';
import { initializeRedlock } from '../utils/redlock.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

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
    
    // Initialize Redlock for distributed locking
    initializeRedlock(redis);
    console.log('🔒 Redlock initialized for distributed locking');
    
    // Initialize liquidator metrics with Redis connection
    liquidatorMetrics.initialize(redis);
    
    // Liquidation checks (5s backup) and metrics cleanup (24h)
    await setupRepeatableJobs(liquidationQueue, [
      { name: 'check-liquidations', data: {}, every: 5000 },
      { name: 'cleanup-metrics', data: {}, every: 86400000 }, // 24 hours
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
      { name: 'daily-summary', data: {}, every: 86400000 }, // 24 hours
    ]);
    
    // Distribution crank (30s)
    await setupRepeatableJobs(distributionCrankQueue, [
      { name: 'distribution-tick', data: {}, every: 30000 },
    ]);
    
    // Schedule LP monitoring job
    await scheduleLPMonitoring();
    console.log('📊 LP monitoring job scheduled');
    
    // Add completed handler for cleanup job
    liquidationWorker.on('completed', async (job, result) => {
      // Special handling for cleanup job
      if (job?.name === 'cleanup-metrics') {
        await liquidatorMetrics.cleanupOldMetrics();
        console.log('✅ Liquidator metrics cleaned up');
        return;
      }
      // Log other completed jobs if needed
    });
    
    // SECURITY: Enhanced error handlers with security logging
    liquidationWorker.on('failed', async (job, err) => {
      console.error(`❌ Liquidation job failed:`, job?.name, err.message);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_FAILED,
        message: `Liquidation worker job failed: ${job?.name}`,
        details: {
          jobName: job?.name,
          jobId: job?.id,
          error: err.message,
          stack: err.stack?.slice(0, 500),
          data: job?.data,
          attemptsMade: job?.attemptsMade,
          queue: 'liquidation',
        },
        source: 'liquidation-worker',
      });
    });
    
    priceMonitorWorker.on('failed', async (job, err) => {
      console.error(`❌ Price monitor job failed:`, job?.name, err.message);
      
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_FAILED,
        message: `Price monitor worker job failed: ${job?.name}`,
        details: {
          jobName: job?.name,
          jobId: job?.id,
          error: err.message,
          attemptsMade: job?.attemptsMade,
          queue: 'price-monitor',
        },
        source: 'price-monitor-worker',
      });
    });
    
    syncWorker.on('failed', async (job, err) => {
      console.error(`❌ Sync job failed:`, job?.name, err.message);
      
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_FAILED,
        message: `Sync worker job failed: ${job?.name}`,
        details: {
          jobName: job?.name,
          jobId: job?.id,
          error: err.message,
          attemptsMade: job?.attemptsMade,
          queue: 'sync',
        },
        source: 'sync-worker',
      });
    });
    
    notificationWorker.on('failed', async (job, err) => {
      console.error(`❌ Notification job failed:`, job?.name, err.message);
      
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_FAILED,
        message: `Notification worker job failed: ${job?.name}`,
        details: {
          jobName: job?.name,
          jobId: job?.id,
          error: err.message,
          attemptsMade: job?.attemptsMade,
          queue: 'notification',
        },
        source: 'notification-worker',
      });
    });
    
    distributionCrankWorker.on('failed', async (job, err) => {
      console.error(`❌ Distribution crank job failed:`, job?.name, err.message);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_FAILED,
        message: `Distribution crank job failed: ${job?.name}`,
        details: {
          jobName: job?.name,
          jobId: job?.id,
          error: err.message,
          stack: err.stack?.slice(0, 500),
          attemptsMade: job?.attemptsMade,
          queue: 'distribution-crank',
        },
        source: 'distribution-crank-worker',
      });
    });

    // SECURITY: Add stalled job handlers for critical workers
    liquidationWorker.on('stalled', async (jobId) => {
      console.warn(`⚠️ Liquidation job stalled: ${jobId}`);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_STALLED,
        message: `Critical liquidation job stalled: ${jobId}`,
        details: { 
          jobId,
          queue: 'liquidation',
          impact: 'liquidations-blocked',
        },
        source: 'liquidation-worker',
      });
    });

    distributionCrankWorker.on('stalled', async (jobId) => {
      console.warn(`⚠️ Distribution crank job stalled: ${jobId}`);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_STALLED,
        message: `Critical distribution crank job stalled: ${jobId}`,
        details: { 
          jobId,
          queue: 'distribution-crank',
          impact: 'rewards-distribution-blocked',
        },
        source: 'distribution-crank-worker',
      });
    });

    priceMonitorWorker.on('stalled', async (jobId) => {
      console.warn(`⚠️ Price monitor job stalled: ${jobId}`);
      
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Background Jobs',
        eventType: SECURITY_EVENT_TYPES.JOB_STALLED,
        message: `Price monitor job stalled: ${jobId}`,
        details: { 
          jobId,
          queue: 'price-monitor',
          impact: 'price-updates-delayed',
        },
        source: 'price-monitor-worker',
      });
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
  
  // Shutdown liquidator metrics
  liquidatorMetrics.shutdown();
  
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

/**
 * Get liquidator health across all instances
 */
export async function getLiquidatorHealth() {
  const instanceHealth = await liquidatorMetrics.getInstanceHealth();
  const allInstances = await liquidatorMetrics.getAllInstancesHealth();
  const globalMetrics = await liquidatorMetrics.getGlobalMetrics();
  
  // Determine overall health
  const healthyInstances = allInstances.filter(i => i.isHealthy).length;
  const totalInstances = allInstances.length;
  const isHealthy = healthyInstances > 0 && (healthyInstances / totalInstances) >= 0.5;
  
  return {
    status: isHealthy ? 'healthy' : 'degraded',
    currentInstance: instanceHealth,
    allInstances,
    globalMetrics,
    summary: {
      totalInstances,
      healthyInstances,
      degradedInstances: totalInstances - healthyInstances,
      totalLiquidations24h: globalMetrics.totalLiquidations24h,
      totalChecks24h: globalMetrics.totalChecks24h,
    }
  };
}