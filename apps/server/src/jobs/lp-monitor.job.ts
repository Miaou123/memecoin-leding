import { Queue, Worker } from 'bullmq';
import { lpLimitsService } from '../services/lp-limits.service.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/client.js';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const LP_MONITOR_QUEUE = 'lp-monitor';

// Create queue
export const lpMonitorQueue = new Queue(LP_MONITOR_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Worker to process LP monitoring
const worker = new Worker(
  LP_MONITOR_QUEUE,
  async (job) => {
    logger.info('[LPMonitor] Starting LP limits monitoring job');
    
    try {
      // Monitor all tokens with active loans
      await lpLimitsService.monitorLPLimits();
      
      // Get all tokens approaching limits for detailed monitoring
      const activeTokens = await prisma.loan.groupBy({
        by: ['tokenMint'],
        where: { status: 'active' },
        _count: { tokenMint: true },
      });
      
      const warnings = [];
      
      for (const { tokenMint } of activeTokens) {
        const usage = await lpLimitsService.getTokenLPUsage(tokenMint);
        if (!usage) continue;
        
        // Track tokens approaching limits
        if (usage.usagePercent >= usage.maxPercent * 0.8) {
          warnings.push({
            tokenMint,
            usagePercent: usage.usagePercent,
            maxPercent: usage.maxPercent,
            activeLoans: activeTokens.find(t => t.tokenMint === tokenMint)?._count.tokenMint || 0,
          });
        }
      }
      
      if (warnings.length > 0) {
        logger.warn('[LPMonitor] Tokens approaching LP limits:', warnings);
      }
      
      logger.info(`[LPMonitor] Monitored ${activeTokens.length} tokens`);
      
      return { 
        success: true, 
        tokensMonitored: activeTokens.length,
        warnings: warnings.length,
      };
    } catch (error) {
      logger.error('[LPMonitor] Job failed:', error);
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 1,
  }
);

// Schedule job to run every 5 minutes
export async function scheduleLPMonitoring(): Promise<void> {
  await lpMonitorQueue.add(
    'monitor-lp-limits',
    {},
    {
      repeat: {
        pattern: '*/5 * * * *', // Every 5 minutes
      },
      jobId: 'lp-monitor-recurring',
    }
  );
  
  logger.info('[LPMonitor] LP monitoring job scheduled');
}

// Handle worker events
worker.on('completed', (job) => {
  logger.info(`[LPMonitor] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`[LPMonitor] Job ${job?.id} failed:`, err);
});