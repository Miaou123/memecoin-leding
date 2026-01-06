import { lpLimitsService } from '../services/lp-limits.service.js';
import { loanService } from '../services/loan.service.js';
import { config } from 'dotenv';

// Load environment variables
config();

// PumpFun tokens (addresses ending in "pump")
// You can find these on pump.fun website
const PUMPFUN_TEST_TOKENS = [
  {
    name: 'EXAMPLE_PUMP',
    mint: 'YourPumpFunTokenAddressHereThatEndsInPump',
    description: 'Replace with actual PumpFun token',
  },
  // Add more PumpFun tokens here
];

// For testing, let's also create a mock test
async function testWithMockToken() {
  console.log('🧪 Testing LP Limits with Mock PumpFun Token\n');
  console.log('================================================\n');
  
  // Since we need a real PumpFun token, let's show how to find them
  console.log('📝 How to find PumpFun tokens for testing:\n');
  console.log('1. Go to https://pump.fun');
  console.log('2. Click on any token');
  console.log('3. Copy the token address (it should end in "pump")');
  console.log('4. Use that address in this test\n');
  
  console.log('Example PumpFun token addresses:');
  console.log('- Look for addresses like: "...pump"');
  console.log('- They always end with "pump"\n');
  
  // Test with a hypothetical token to show the flow
  const mockToken = {
    name: 'TEST_PUMP',
    mint: 'TESTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxpump', // Mock address
  };
  
  console.log(`\n📊 Testing ${mockToken.name} (Mock Token)`);
  console.log(`   Mint: ${mockToken.mint}`);
  console.log('   -------------------------------------------');
  
  try {
    // This will fail with mock token but shows the flow
    const usage = await lpLimitsService.getTokenLPUsage(mockToken.mint);
    
    if (!usage) {
      console.log('   ℹ️  No LP data available (expected for mock token)');
      
      // Show what would happen with real token
      console.log('\n   📋 With a real PumpFun token, you would see:');
      console.log('   - LP Value from DexScreener');
      console.log('   - Current loan usage percentage');
      console.log('   - Maximum allowed loan amount');
      console.log('   - Whether new loans would be blocked');
    }
    
  } catch (error: any) {
    console.log(`   ℹ️  Expected error for mock token: ${error.message}`);
  }
  
  console.log('\n================================================\n');
  
  // Show how to manually test LP limits
  console.log('🔧 Manual Testing Steps:\n');
  console.log('1. Find a PumpFun token address from pump.fun');
  console.log('2. Check its liquidity on DexScreener:');
  console.log('   https://dexscreener.com/solana/[TOKEN_ADDRESS]');
  console.log('3. Run this command with the token:');
  console.log('   npm run test:custom-token -- [TOKEN_ADDRESS]\n');
}

// Test with command line argument
async function testCustomToken() {
  const tokenMint = process.argv[2];
  
  if (!tokenMint) {
    console.log('❌ Please provide a token address as argument');
    console.log('Usage: npm run test:custom-token -- [TOKEN_ADDRESS]');
    console.log('\nExample:');
    console.log('npm run test:custom-token -- YourTokenAddressHereThatEndsInPump');
    return;
  }
  
  console.log('🧪 Testing Custom Token\n');
  console.log('================================================\n');
  
  console.log(`📊 Testing token: ${tokenMint}`);
  console.log('   -------------------------------------------');
  
  try {
    // Check if it's a PumpFun token
    if (!tokenMint.endsWith('pump')) {
      console.log('   ⚠️  Warning: Token address does not end in "pump"');
      console.log('   Your verification service requires PumpFun tokens');
    }
    
    // Test LP limits
    const usage = await lpLimitsService.getTokenLPUsage(tokenMint);
    
    if (!usage) {
      console.log('   ❌ Could not fetch LP data');
      console.log('   Make sure the token has liquidity on DEX');
      return;
    }
    
    console.log(`   💰 LP Value: $${usage.lpValueUSD.toLocaleString()}`);
    console.log(`   📈 Active Loans: $${usage.totalActiveLoansUSD.toLocaleString()}`);
    console.log(`   📊 Usage: ${usage.usagePercent.toFixed(2)}% / ${usage.maxPercent}%`);
    
    // Test loan amounts
    const testAmounts = [0.1, 1, 10, 100];
    console.log('\n   🧪 Testing loan limits:');
    
    for (const sol of testAmounts) {
      const lamports = (sol * 1e9).toString();
      const result = await lpLimitsService.checkLPLimits(tokenMint, lamports);
      
      const icon = result.allowed ? '✅' : '❌';
      console.log(`   ${icon} ${sol} SOL: ${result.allowed ? 'Allowed' : 'Blocked'}`);
      
      if (!result.allowed) {
        console.log(`      ${result.reason}`);
        break;
      }
    }
    
    // Try loan estimation if it's a valid PumpFun token
    if (tokenMint.endsWith('pump')) {
      console.log('\n   📝 Testing loan estimation...');
      
      try {
        const estimate = await loanService.estimateLoan({
          tokenMint,
          collateralAmount: '1000000', // Small amount
          durationSeconds: 86400,
        });
        
        console.log('   ✅ Token is valid for loans!');
        console.log(`      Max loan: ${(parseFloat(estimate.solAmount) / 1e9).toFixed(4)} SOL`);
        
      } catch (error: any) {
        console.log(`   ❌ Loan estimation failed: ${error.message}`);
      }
    }
    
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

// Main execution
async function main() {
  const tokenArg = process.argv[2];
  
  if (tokenArg) {
    // Test specific token
    await testCustomToken();
  } else {
    // Show instructions
    await testWithMockToken();
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});