import { Job } from 'bullmq';
import { protocolService } from '../services/protocol.service.js';
import { prisma } from '../db/client.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';

export async function syncJob(job: Job) {
  const jobName = job.name;
  
  try {
    if (jobName === 'sync-protocol-state') {
      console.log('🔄 Syncing protocol state...');
      
      // Update protocol stats
      await protocolService.getProtocolStats();
      
      console.log('✅ Protocol state sync completed');
      
      return { status: 'protocol_state_synced' };
      
    } else if (jobName === 'sync-loans') {
      console.log('🔄 Syncing loan data...');
      
      // Get all active loans from database
      const activeLoans = await prisma.loan.findMany({
        where: { status: 'active' },
      });
      
      let syncedCount = 0;
      let errorCount = 0;
      
      // Check each loan's current status on-chain
      // This is simplified - in practice you'd batch these calls
      for (const loan of activeLoans) {
        try {
          // In a real implementation, you'd have the SDK client available
          // and check the loan's current state
          
          // For now, just check if loan is past due
          const now = new Date();
          if (now > loan.dueAt && loan.status === 'active') {
            // Loan is overdue but not liquidated - potential inconsistency
            console.warn(`⚠️  Loan ${loan.id} is overdue but still active`);
          }
          
          syncedCount++;
        } catch (error) {
          console.error(`Failed to sync loan ${loan.id}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Loan sync completed: ${syncedCount} synced, ${errorCount} errors`);
      
      return {
        status: 'loans_synced',
        synced: syncedCount,
        errors: errorCount,
      };
    }
    
  } catch (error) {
    console.error(`❌ Sync job (${jobName}) failed:`, error);
    throw error;
  }
}