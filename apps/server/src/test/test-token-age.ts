#!/usr/bin/env tsx
import { tokenVerificationService } from '../services/token-verification.service.js';
import chalk from 'chalk';

/**
 * Test token age verification
 * Usage: npm run test:token-age
 */

async function testTokenAge() {
  console.log(chalk.blue('\n=== Token Age Verification Test ==='));
  console.log(chalk.gray(`Minimum age requirement: ${process.env.MIN_TOKEN_AGE_HOURS || 24} hours`));
  console.log();

  // Test tokens - you may need to update these with current examples
  const testCases = [
    {
      description: 'Old established token (should pass)',
      // BONK token - created long ago
      address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      expectedResult: 'pass',
    },
    {
      description: 'Recent PumpFun token (might fail)',
      // You'll need to find a recent token on pump.fun
      address: 'REPLACE_WITH_NEW_TOKEN_pump',
      expectedResult: 'fail',
    },
  ];

  for (const testCase of testCases) {
    if (testCase.address.includes('REPLACE')) {
      console.log(chalk.yellow(`\n${testCase.description}`));
      console.log(chalk.gray('  ⚠️  Please replace with an actual token address'));
      console.log(chalk.gray('  Visit https://pump.fun to find a recently created token'));
      continue;
    }

    console.log(chalk.yellow(`\n${testCase.description}`));
    console.log(chalk.gray(`  Token: ${testCase.address}`));
    
    try {
      const result = await tokenVerificationService.verifyToken(testCase.address);
      
      if (result.isValid) {
        console.log(chalk.green('  ✓ Token passed verification'));
        if (testCase.expectedResult === 'fail') {
          console.log(chalk.yellow('  ⚠️  Expected to fail age check but passed'));
        }
      } else {
        console.log(chalk.red('  ✗ Token failed verification'));
        console.log(`  Reason: ${result.reason}`);
        console.log(`  Code: ${result.rejectionCode}`);
        
        if (result.rejectionCode === 'TOKEN_TOO_NEW') {
          console.log(chalk.cyan('  🕒 Token age check triggered!'));
          
          // Extract age info from reason string
          const ageMatch = result.reason?.match(/\((\d+ \w+) old\)/);
          if (ageMatch) {
            console.log(`  Current age: ${ageMatch[1]}`);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('  Error:'), error);
    }
  }
  
  console.log(chalk.blue('\n=== Testing with custom age requirement ==='));
  
  // Test with different age requirements
  const originalEnv = process.env.MIN_TOKEN_AGE_HOURS;
  
  try {
    // Test with 1 hour requirement
    process.env.MIN_TOKEN_AGE_HOURS = '1';
    console.log(chalk.gray('\nTesting with MIN_TOKEN_AGE_HOURS=1...'));
    
    // Clear cache to ensure fresh verification
    tokenVerificationService.clearCache();
    
    // Most tokens should pass 1 hour check
    const testToken = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const result = await tokenVerificationService.verifyToken(testToken);
    
    if (result.isValid) {
      console.log(chalk.green('✓ Token passed 1-hour age check'));
    } else if (result.rejectionCode === 'TOKEN_TOO_NEW') {
      console.log(chalk.red('✗ Token failed even 1-hour check (very new token!)'));
    }
    
  } finally {
    // Restore original setting
    if (originalEnv) {
      process.env.MIN_TOKEN_AGE_HOURS = originalEnv;
    } else {
      delete process.env.MIN_TOKEN_AGE_HOURS;
    }
    tokenVerificationService.clearCache();
  }
  
  console.log(chalk.gray('\n' + '='.repeat(50)));
  console.log(chalk.green('✅ Token age verification test complete\n'));
}

// Run the test
testTokenAge().catch(console.error);