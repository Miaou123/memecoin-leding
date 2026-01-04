import { Job } from 'bullmq';
import { distributionCrankService } from '../services/distribution-crank.service.js';

export async function distributionCrankJob(job: Job) {
  const jobName = job.name;
  
  try {
    if (jobName === 'distribution-tick') {
      console.log('🔄 Distribution crank tick...');
      
      const result = await distributionCrankService.tick();
      
      if (result.success) {
        if (result.epochAdvanced) {
          console.log(`✅ Epoch advanced. Distributed to ${result.usersDistributed} users.`);
        } else if (result.usersDistributed > 0) {
          console.log(`✅ Distributed to ${result.usersDistributed} users.`);
        }
      } else if (result.errors.length > 0) {
        console.error('❌ Distribution tick failed:', result.errors);
      }
      
      return {
        status: result.success ? 'success' : 'failed',
        epochAdvanced: result.epochAdvanced,
        usersDistributed: result.usersDistributed,
        batches: result.batches,
        errors: result.errors,
      };
    }
    
  } catch (error: any) {
    console.error(`❌ Distribution crank job (${jobName}) failed:`, error.message);
    throw error;
  }
}
