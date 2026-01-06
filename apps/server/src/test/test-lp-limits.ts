import { lpLimitsService } from '../services/lp-limits.service.js';
import { priceService } from '../services/price.service.js';
import { config } from 'dotenv';

// Load environment variables
config();

// Test tokens - use real mainnet tokens
const TEST_TOKENS = [
  {
    name: 'BONK',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    description: 'Popular memecoin with good liquidity',
  },
  {
    name: 'WIF', 
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    description: 'dogwifhat token',
  },
  {
    name: 'POPCAT',
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    description: 'POPCAT token',
  },
];

async function testLPLimits() {
  console.log('🧪 Testing LP Limits Service\n');
  console.log('================================================\n');

  // Set protocol token if configured
  const protocolTokenMint = process.env.PROTOCOL_TOKEN_MINT;
  if (protocolTokenMint) {
    console.log(`✅ Protocol Token Configured: ${protocolTokenMint}`);
    console.log('   (Will use 50% LP limit instead of 20%)\n');
  } else {
    console.log('ℹ️  No protocol token configured (all tokens use 20% limit)\n');
  }

  for (const token of TEST_TOKENS) {
    console.log(`\n📊 Testing ${token.name} (${token.description})`);
    console.log(`   Mint: ${token.mint}`);
    console.log('   -------------------------------------------');

    try {
      // Get LP usage stats
      const usage = await lpLimitsService.getTokenLPUsage(token.mint);
      
      if (!usage) {
        console.log('   ❌ Could not fetch LP data');
        continue;
      }

      console.log(`   💰 LP Value: $${usage.lpValueUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log(`   📈 Active Loans: $${usage.totalActiveLoansUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log(`   📊 Usage: ${usage.usagePercent.toFixed(2)}% / ${usage.maxPercent}%`);
      
      // Test different loan amounts
      const testAmounts = [
        { sol: 1, lamports: '1000000000' },
        { sol: 10, lamports: '10000000000' },
      ];

      console.log('\n   🧪 Testing loan creation limits:');
      
      for (const amount of testAmounts) {
        const result = await lpLimitsService.checkLPLimits(token.mint, amount.lamports);
        const icon = result.allowed ? '✅' : '❌';
        console.log(`   ${icon} ${amount.sol} SOL loan: ${result.allowed ? 'Allowed' : 'Blocked'}`);
        
        if (!result.allowed) {
          console.log(`      Reason: ${result.reason}`);
        } else {
          const newUsage = ((result.currentUsage + (amount.sol * (await priceService.getSolPrice()))) / result.lpValue) * 100;
          console.log(`      Would bring usage to: ${newUsage.toFixed(2)}%`);
        }
      }

      // Calculate maximum allowed loan
      const solPrice = await priceService.getSolPrice();
      const maxLoanUSD = (usage.lpValueUSD * usage.maxPercent / 100) - usage.totalActiveLoansUSD;
      const maxLoanSOL = maxLoanUSD / solPrice;
      
      console.log(`\n   💡 Maximum new loan allowed: ${maxLoanSOL.toFixed(2)} SOL ($${maxLoanUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n\n================================================');
  console.log('✅ LP Limits Test Complete\n');

  // Test with a protocol token if configured
  if (protocolTokenMint) {
    console.log('\n🎯 Testing Protocol Token (50% limit):');
    console.log('================================================\n');
    
    const result = await lpLimitsService.checkLPLimits(protocolTokenMint, '100000000000'); // 100 SOL
    console.log(`Protocol token ${protocolTokenMint.substring(0, 8)}...`);
    console.log(`100 SOL loan: ${result.allowed ? '✅ Allowed' : '❌ Blocked'}`);
    console.log(`Is Protocol Token: ${result.isProtocolToken ? 'Yes' : 'No'}`);
    console.log(`Max Allowed: ${(result.maxUsage / 1e9).toFixed(2)} SOL`);
  }

  process.exit(0);
}

// Run test
testLPLimits().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});