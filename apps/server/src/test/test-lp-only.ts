import { lpLimitsService } from '../services/lp-limits.service.js';
import { priceService } from '../services/price.service.js';
import { config } from 'dotenv';

// Load environment variables
config();

// Test LP limits without loan verification
async function testLPLimitsOnly() {
  const tokenMint = process.argv[2];
  
  if (!tokenMint) {
    console.log('❌ Please provide a token address');
    console.log('\nUsage: npm run test:lp-only -- [TOKEN_ADDRESS]');
    console.log('\nExamples:');
    console.log('npm run test:lp-only -- DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263  # BONK');
    console.log('npm run test:lp-only -- EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm  # WIF');
    console.log('npm run test:lp-only -- 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr  # POPCAT');
    return;
  }
  
  console.log('🧪 Testing LP Limits Only (No Token Verification)\n');
  console.log('================================================\n');
  
  console.log(`📊 Analyzing token: ${tokenMint}`);
  console.log('   -------------------------------------------');
  
  try {
    // 1. Fetch extended price data with liquidity
    console.log('\n   🔍 Fetching token data from DexScreener...');
    const priceData = await priceService.getExtendedPriceData(tokenMint);
    
    if (priceData.liquidity?.usd) {
      console.log(`   ✅ Found liquidity data!`);
      console.log(`   💰 LP Value: $${priceData.liquidity.usd.toLocaleString()}`);
    } else {
      console.log('   ❌ No liquidity data found');
      console.log('   Token might not be listed on DEX or has no liquidity');
      return;
    }
    
    // 2. Get current token price
    console.log(`\n   💵 Token Price: $${priceData.price}`);
    
    // 3. Test LP limits
    const usage = await lpLimitsService.getTokenLPUsage(tokenMint);
    
    if (usage) {
      console.log(`\n   📊 LP Usage Analysis:`);
      console.log(`   Active Loans Value: $${usage.totalActiveLoansUSD.toLocaleString()}`);
      console.log(`   Current Usage: ${usage.usagePercent.toFixed(2)}% / ${usage.maxPercent}%`);
      
      const isProtocolToken = process.env.PROTOCOL_TOKEN_MINT === tokenMint;
      console.log(`   Is Protocol Token: ${isProtocolToken ? 'Yes (50% limit)' : 'No (20% limit)'}`);
      
      // Calculate remaining capacity
      const remainingCapacity = (usage.lpValueUSD * usage.maxPercent / 100) - usage.totalActiveLoansUSD;
      const solPrice = await priceService.getSolPrice();
      const remainingCapacitySOL = remainingCapacity / solPrice;
      
      console.log(`\n   📈 Remaining Loan Capacity:`);
      console.log(`   USD: $${remainingCapacity.toLocaleString()}`);
      console.log(`   SOL: ${remainingCapacitySOL.toFixed(2)} SOL`);
      
      // Test various loan amounts
      console.log('\n   🧪 Testing Different Loan Amounts:');
      const testAmounts = [1, 10, 100, 1000];
      
      for (const solAmount of testAmounts) {
        const lamports = (solAmount * 1e9).toString();
        const check = await lpLimitsService.checkLPLimits(tokenMint, lamports);
        
        const icon = check.allowed ? '✅' : '❌';
        const usdValue = solAmount * solPrice;
        console.log(`   ${icon} ${solAmount} SOL ($${usdValue.toLocaleString()}): ${check.allowed ? 'ALLOWED' : 'BLOCKED'}`);
        
        if (!check.allowed) {
          console.log(`      Reason: ${check.reason}`);
        }
      }
      
      // Show warning levels
      console.log('\n   ⚠️  Warning Levels:');
      const warningLevel = usage.usagePercent / usage.maxPercent * 100;
      if (warningLevel >= 80) {
        console.log('   🔴 CRITICAL: Approaching maximum capacity!');
      } else if (warningLevel >= 60) {
        console.log('   🟠 WARNING: High usage level');
      } else if (warningLevel >= 40) {
        console.log('   🟡 MODERATE: Normal usage');
      } else {
        console.log('   🟢 LOW: Plenty of capacity available');
      }
      
    } else {
      console.log('   ❌ Could not calculate LP usage');
    }
    
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    
    if (error.message.includes('fetch')) {
      console.log('\n   💡 Tip: Make sure you have internet connection');
    }
  }
  
  console.log('\n================================================');
  console.log('✅ LP Analysis Complete\n');
}

// Run the test
testLPLimitsOnly().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});