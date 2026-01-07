import { Job } from 'bullmq';
import { loanService } from '../services/loan.service.js';
import { notificationService } from '../services/notification.service.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { liquidatorMetrics } from '../services/liquidator-metrics.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

export async function liquidationJob(job: Job) {
  console.log('🔍 Checking for liquidatable loans...');
  
  // Record job start time for metrics
  const startTime = await liquidatorMetrics.recordJobStart();
  
  // SECURITY: Log job start
  await securityMonitor.log({
    severity: 'LOW',
    category: 'Liquidation',
    eventType: SECURITY_EVENT_TYPES.LIQUIDATION_JOB_STARTED,
    message: 'Liquidation check job started',
    details: { 
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
    },
    source: 'liquidation-job',
  });
  
  try {
    const liquidatableLoans = await loanService.checkLiquidatableLoans();
    
    if (liquidatableLoans.length === 0) {
      console.log('✅ No liquidatable loans found');
      
      // Record successful completion with no liquidations
      await liquidatorMetrics.recordJobSuccess(startTime, 0);
      
      // SECURITY: Log successful job completion with no liquidations
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Liquidation',
        eventType: SECURITY_EVENT_TYPES.LIQUIDATION_JOB_COMPLETED,
        message: 'Liquidation job completed: no liquidatable loans found',
        details: { 
          jobId: job.id,
          totalChecked: 0,
          liquidated: 0,
          errors: 0,
        },
        source: 'liquidation-job',
      });
      
      return { liquidated: 0 };
    }
    
    console.log(`⚠️  Found ${liquidatableLoans.length} liquidatable loans`);
    
    // SECURITY: Log when liquidatable loans are found
    await securityMonitor.log({
      severity: liquidatableLoans.length > 5 ? 'HIGH' : 'MEDIUM',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_LOANS_FOUND,
      message: `Found ${liquidatableLoans.length} liquidatable loans`,
      details: { 
        count: liquidatableLoans.length,
        loans: liquidatableLoans.slice(0, 10), // First 10 loans
        jobId: job.id,
      },
      source: 'liquidation-job',
    });
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process liquidations
    for (const loanPubkey of liquidatableLoans) {
      try {
        // In production, this would use a liquidator bot wallet
        const liquidatorWallet = process.env.LIQUIDATOR_WALLET || process.env.ADMIN_WALLET;
        
        if (!liquidatorWallet) {
          console.error('No liquidator wallet configured');
          errorCount++;
          
          // SECURITY: Alert when no liquidator wallet is configured
          await securityMonitor.log({
            severity: 'CRITICAL',
            category: 'Liquidation',
            eventType: SECURITY_EVENT_TYPES.LIQUIDATION_NO_WALLET,
            message: 'No liquidator wallet configured - liquidations cannot proceed!',
            details: {
              envVars: ['LIQUIDATOR_WALLET', 'ADMIN_WALLET'],
              liquidatableCount: liquidatableLoans.length,
              currentLoan: loanPubkey,
              jobId: job.id,
            },
            source: 'liquidation-job',
          });
          
          continue;
        }
        
        await loanService.liquidateLoan(loanPubkey, liquidatorWallet);
        successCount++;
        
        console.log(`✅ Liquidated loan: ${loanPubkey}`);
        
        // Small delay to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error: any) {
        console.error(`❌ Failed to liquidate loan ${loanPubkey}:`, error);
        errorCount++;
        
        // SECURITY: Log individual liquidation failures
        await securityMonitor.log({
          severity: 'HIGH',
          category: 'Liquidation',
          eventType: SECURITY_EVENT_TYPES.LIQUIDATION_FAILED,
          message: `Failed to liquidate loan ${loanPubkey.substring(0, 8)}...`,
          details: {
            loanPubkey,
            error: error.message,
            stack: error.stack?.slice(0, 500),
            attempt: (successCount + errorCount),
            jobId: job.id,
          },
          source: 'liquidation-job',
        });
      }
    }
    
    const result = {
      totalChecked: liquidatableLoans.length,
      liquidated: successCount,
      errors: errorCount,
    };
    
    console.log('🏁 Liquidation job completed:', result);
    
    // Record successful job completion with metrics
    await liquidatorMetrics.recordJobSuccess(startTime, successCount);
    
    // SECURITY: Log job completion with error analysis
    if (errorCount > 0) {
      await securityMonitor.log({
        severity: errorCount === liquidatableLoans.length ? 'CRITICAL' : 'HIGH',
        category: 'Liquidation',
        eventType: SECURITY_EVENT_TYPES.LIQUIDATION_JOB_ERRORS,
        message: `Liquidation job completed with ${errorCount} errors`,
        details: {
          totalChecked: liquidatableLoans.length,
          successful: successCount,
          failed: errorCount,
          successRate: liquidatableLoans.length > 0 
            ? `${((successCount / liquidatableLoans.length) * 100).toFixed(1)}%`
            : 'N/A',
          jobId: job.id,
        },
        source: 'liquidation-job',
      });
    } else {
      // SECURITY: Log successful completion
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Liquidation',
        eventType: SECURITY_EVENT_TYPES.LIQUIDATION_JOB_COMPLETED,
        message: `Liquidation job completed: ${successCount} liquidated successfully`,
        details: result,
        source: 'liquidation-job',
      });
    }
    
    return result;
    
  } catch (error: any) {
    console.error('❌ Liquidation job failed:', error);
    
    // Record job failure in metrics
    await liquidatorMetrics.recordJobFailure(error);
    
    // SECURITY: Log job-level failures
    await securityMonitor.log({
      severity: 'CRITICAL',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.JOB_FAILED,
      message: `Liquidation job failed: ${error.message}`,
      details: {
        jobId: job.id,
        jobName: job.name,
        error: error.message,
        stack: error.stack?.slice(0, 1000),
      },
      source: 'liquidation-job',
    });
    
    throw error;
  }
}