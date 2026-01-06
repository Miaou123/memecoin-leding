import { loanService } from '../services/loan.service.js';
import { lpLimitsService } from '../services/lp-limits.service.js';
import { config } from 'dotenv';

// Load environment variables
config();

// Test configuration
const TEST_BORROWER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Example wallet
const TEST_TOKENS = [
  {
    name: 'BONK',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  },
  {
    name: 'WIF',
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  },
];

async function testLoanCreationFlow() {
  console.log('🧪 Testing Loan Creation Flow with LP Limits\n');
  console.log('================================================\n');
  
  for (const token of TEST_TOKENS) {
    console.log(`\n📊 Testing ${token.name} loan creation`);
    console.log(`   Mint: ${token.mint}`);
    console.log('   -------------------------------------------');
    
    try {
      // 1. Get current LP usage
      const usage = await lpLimitsService.getTokenLPUsage(token.mint);
      if (!usage) {
        console.log('   ❌ Could not fetch LP data');
        continue;
      }
      
      console.log(`   💰 Current LP Usage: ${usage.usagePercent.toFixed(2)}% / ${usage.maxPercent}%`);
      
      // 2. Try to estimate a loan (this will trigger verification)
      const loanParams = {
        tokenMint: token.mint,
        collateralAmount: '1000000000', // 1 billion tokens (adjust based on decimals)
        durationSeconds: 86400, // 1 day
      };
      
      console.log('\n   📝 Attempting to estimate loan...');
      console.log(`      Collateral: ${loanParams.collateralAmount}`);
      console.log(`      Duration: ${loanParams.durationSeconds / 3600} hours`);
      
      try {
        const estimate = await loanService.estimateLoan(loanParams);
        
        console.log('\n   ✅ Loan estimate successful:');
        console.log(`      SOL Amount: ${(parseFloat(estimate.solAmount) / 1e9).toFixed(4)} SOL`);
        console.log(`      Protocol Fee: ${(parseFloat(estimate.fees.protocolFee) / 1e9).toFixed(4)} SOL`);
        console.log(`      LTV: ${estimate.ltv}%`);
        console.log(`      Liquidation Price: ${estimate.liquidationPrice}`);
        
        // 3. Check if this loan would be allowed
        const lpCheck = await lpLimitsService.checkLPLimits(token.mint, estimate.solAmount);
        
        console.log('\n   🔍 LP Limit Check:');
        console.log(`      Result: ${lpCheck.allowed ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`      Current Usage: $${lpCheck.currentUsage.toFixed(2)}`);
        console.log(`      Max Allowed: $${lpCheck.maxUsage.toFixed(2)}`);
        console.log(`      LP Value: $${lpCheck.lpValue.toFixed(2)}`);
        
        if (!lpCheck.allowed) {
          console.log(`      Reason: ${lpCheck.reason}`);
        }
        
        // 4. Simulate creating the loan (without actually sending to chain)
        if (lpCheck.allowed) {
          console.log('\n   🚀 Simulating loan creation...');
          
          try {
            // This will create the unsigned transaction
            const createParams = {
              ...loanParams,
              borrower: TEST_BORROWER,
            };
            
            // Note: This will fail if token not whitelisted in DB
            // const result = await loanService.createLoan(createParams);
            // console.log('      Transaction created (not sent)');
            console.log('      [Skipping actual transaction creation in test]');
            
          } catch (error: any) {
            console.log(`      Error: ${error.message}`);
          }
        }
        
      } catch (error: any) {
        console.log(`   ❌ Loan estimate failed: ${error.message}`);
        
        // Check if it's due to token not being whitelisted
        if (error.message.includes('not whitelisted')) {
          console.log('   ℹ️  Token needs to be whitelisted in database first');
        }
      }
      
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n\n================================================');
  console.log('✅ Loan Flow Test Complete\n');
  
  // Show monitoring status
  console.log('📡 Monitoring Status:');
  const { programMonitor } = await import('../services/program-monitor.service.js');
  const monitorStats = programMonitor.getStats();
  console.log(`   Program Monitor: ${monitorStats.isMonitoring ? '✅ Active' : '❌ Inactive'}`);
  console.log(`   Tracked Transactions: ${monitorStats.trackedTransactions}`);
  console.log(`   Program ID: ${monitorStats.programId.substring(0, 8)}...`);
  
  process.exit(0);
}

// Run test
testLoanCreationFlow().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});