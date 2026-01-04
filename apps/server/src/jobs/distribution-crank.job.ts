import { Job, Queue, Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { distributionCrankService } from '../services/distribution-crank.service';

// Job data interface
export interface DistributionCrankJobData {
  timestamp: number;
}

// Job result interface
export interface DistributionCrankJobResult {
  success: boolean;
  epochAdvanced: boolean;
  usersDistributed: number;
  totalDistributed: string; // BigInt as string
  batches: number;
  errors: string[];
  processedAt: number;
}

// Queue configuration
export const DISTRIBUTION_CRANK_QUEUE = 'distribution-crank';

// Create the queue
export const distributionCrankQueue = new Queue<DistributionCrankJobData, DistributionCrankJobResult>(
  DISTRIBUTION_CRANK_QUEUE,
  {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 10, // Keep last 10 successful jobs
      removeOnFail: 20,     // Keep last 20 failed jobs
      attempts: 3,          // Retry failed jobs up to 3 times
      backoff: {
        type: 'exponential',
        delay: 5000,        // Start with 5 second delay
      },
    },
  }
);

// Job processor
const processDistributionCrankJob = async (
  job: Job<DistributionCrankJobData, DistributionCrankJobResult>
): Promise<DistributionCrankJobResult> => {
  console.log('🏗️ Processing distribution crank job:', job.id);
  
  try {
    // Initialize service if not already done
    if (!distributionCrankService) {
      throw new Error('Distribution crank service not available');
    }
    
    await distributionCrankService.initialize();
    
    // Execute distribution tick
    const result = await distributionCrankService.tick();
    
    // Convert BigInt to string for JSON serialization
    const jobResult: DistributionCrankJobResult = {
      success: result.success,
      epochAdvanced: result.epochAdvanced,
      usersDistributed: result.usersDistributed,
      totalDistributed: result.totalDistributed.toString(),
      batches: result.batches,
      errors: result.errors,
      processedAt: Date.now(),
    };
    
    // Log results
    if (result.epochAdvanced) {
      console.log('✅ Distribution crank: Epoch advanced');
    }
    
    if (result.usersDistributed > 0) {
      console.log(`✅ Distribution crank: Distributed to ${result.usersDistributed} users in ${result.batches} batches`);
    }
    
    if (result.errors.length > 0) {
      console.log(`⚠️ Distribution crank: ${result.errors.length} errors:`, result.errors);
    }
    
    return jobResult;
    
  } catch (error: any) {
    console.error('❌ Distribution crank job failed:', error.message);
    
    const jobResult: DistributionCrankJobResult = {
      success: false,
      epochAdvanced: false,
      usersDistributed: 0,
      totalDistributed: '0',
      batches: 0,
      errors: [error.message],
      processedAt: Date.now(),
    };
    
    return jobResult;
  }
};

// Create the worker
export const distributionCrankWorker = new Worker<DistributionCrankJobData, DistributionCrankJobResult>(
  DISTRIBUTION_CRANK_QUEUE,
  processDistributionCrankJob,
  {
    connection: redisConnection,
    concurrency: 1, // Process one job at a time to avoid conflicts
  }
);

// Worker event handlers
distributionCrankWorker.on('completed', (job: Job, result: DistributionCrankJobResult) => {
  console.log(`✅ Distribution crank job ${job.id} completed:`, {
    epochAdvanced: result.epochAdvanced,
    usersDistributed: result.usersDistributed,
    batches: result.batches,
    errors: result.errors.length,
  });
});

distributionCrankWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`❌ Distribution crank job ${job?.id} failed:`, err.message);
});

distributionCrankWorker.on('stalled', (jobId: string) => {
  console.warn(`⚠️ Distribution crank job ${jobId} stalled`);
});

// Schedule recurring job
export const scheduleDistributionCrankJob = async (): Promise<void> => {
  console.log('📅 Scheduling distribution crank job...');
  
  try {
    // Remove existing repeatable jobs to avoid duplicates
    const repeatableJobs = await distributionCrankQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await distributionCrankQueue.removeRepeatableByKey(job.key);
    }
    
    // Schedule the job to run every 30 seconds
    await distributionCrankQueue.add(
      'distribution-tick',
      { timestamp: Date.now() },
      {
        repeat: {
          every: 30000, // 30 seconds
        },
        jobId: 'distribution-crank-recurring', // Fixed ID to prevent duplicates
      }
    );
    
    console.log('✅ Distribution crank job scheduled (every 30 seconds)');
    
  } catch (error: any) {
    console.error('❌ Failed to schedule distribution crank job:', error.message);
    throw error;
  }
};

// Stop the crank
export const stopDistributionCrank = async (): Promise<void> => {
  console.log('🛑 Stopping distribution crank...');
  
  try {
    // Remove all repeatable jobs
    const repeatableJobs = await distributionCrankQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await distributionCrankQueue.removeRepeatableByKey(job.key);
    }
    
    // Close worker
    await distributionCrankWorker.close();
    
    console.log('✅ Distribution crank stopped');
    
  } catch (error: any) {
    console.error('❌ Failed to stop distribution crank:', error.message);
    throw error;
  }
};

// Get crank status
export const getDistributionCrankStatus = async (): Promise<{
  isScheduled: boolean;
  queueStats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  repeatableJobs: number;
  lastJob?: {
    id: string;
    timestamp: number;
    result?: DistributionCrankJobResult;
  };
}> => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      distributionCrankQueue.getWaiting(),
      distributionCrankQueue.getActive(),
      distributionCrankQueue.getCompleted(),
      distributionCrankQueue.getFailed(),
      distributionCrankQueue.getDelayed(),
    ]);
    
    const repeatableJobs = await distributionCrankQueue.getRepeatableJobs();
    
    // Get last completed job
    let lastJob;
    if (completed.length > 0) {
      const lastCompletedJob = completed[0];
      lastJob = {
        id: lastCompletedJob.id || 'unknown',
        timestamp: lastCompletedJob.timestamp || 0,
        result: lastCompletedJob.returnvalue,
      };
    }
    
    return {
      isScheduled: repeatableJobs.length > 0,
      queueStats: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      },
      repeatableJobs: repeatableJobs.length,
      lastJob,
    };
    
  } catch (error: any) {
    console.error('❌ Failed to get distribution crank status:', error.message);
    throw error;
  }
};