import { Job } from 'bullmq';
import { loanService } from '../services/loan.service.js';
import { notificationService } from '../services/notification.service.js';

export async function liquidationJob(job: Job) {
  console.log('🔍 Checking for liquidatable loans...');
  
  try {
    const liquidatableLoans = await loanService.checkLiquidatableLoans();
    
    if (liquidatableLoans.length === 0) {
      console.log('✅ No liquidatable loans found');
      return { liquidated: 0 };
    }
    
    console.log(`⚠️  Found ${liquidatableLoans.length} liquidatable loans`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process liquidations
    for (const loanPubkey of liquidatableLoans) {
      try {
        // In production, this would use a liquidator bot wallet
        const liquidatorWallet = process.env.LIQUIDATOR_WALLET || process.env.ADMIN_WALLET;
        
        if (!liquidatorWallet) {
          console.error('No liquidator wallet configured');
          continue;
        }
        
        await loanService.liquidateLoan(loanPubkey, liquidatorWallet);
        successCount++;
        
        console.log(`✅ Liquidated loan: ${loanPubkey}`);
        
        // Small delay to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Failed to liquidate loan ${loanPubkey}:`, error);
        errorCount++;
      }
    }
    
    const result = {
      totalChecked: liquidatableLoans.length,
      liquidated: successCount,
      errors: errorCount,
    };
    
    console.log('🏁 Liquidation job completed:', result);
    
    return result;
    
  } catch (error) {
    console.error('❌ Liquidation job failed:', error);
    throw error;
  }
}