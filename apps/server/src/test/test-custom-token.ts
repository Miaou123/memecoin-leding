#!/usr/bin/env tsx
import { tokenVerificationService } from '../services/token-verification.service.js';
import chalk from 'chalk';

/**
 * Test PumpFun and Bonk token verification with specific token addresses
 * Usage: npm run test:custom-token -- [TOKEN_ADDRESS]
 */

async function testCustomToken() {
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.log(chalk.red('Usage: npm run test:custom-token -- [TOKEN_ADDRESS]'));
    console.log(chalk.yellow('\nExample addresses:'));
    console.log(chalk.gray('  PumpFun: ...pump'));
    console.log(chalk.gray('  Bonk/Raydium: ...bonk'));
    process.exit(1);
  }

  console.log(chalk.blue('\n=== Token Verification Test ==='));
  console.log(chalk.gray(`Token: ${tokenAddress}`));
  console.log();

  try {
    console.log(chalk.yellow('Verifying token...'));
    const result = await tokenVerificationService.verifyToken(tokenAddress);
    
    console.log();
    console.log(chalk.blue('Verification Result:'));
    console.log(chalk.gray('─'.repeat(50)));
    
    if (result.isValid) {
      console.log(chalk.green('✓ Token is VALID'));
      console.log();
      
      // Basic info
      if (result.symbol || result.name) {
        console.log(chalk.white('Token Info:'));
        if (result.name) console.log(`  Name: ${result.name}`);
        if (result.symbol) console.log(`  Symbol: ${result.symbol}`);
        console.log();
      }
      
      // DEX and liquidity
      console.log(chalk.white('Market Data:'));
      console.log(`  DEX: ${result.dexId || 'Unknown'}`);
      console.log(`  Liquidity: $${result.liquidity.toLocaleString()}`);
      if (result.tier) console.log(`  Tier: ${result.tier}`);
      console.log();
      
      // Pool balance
      if (result.poolBalance) {
        console.log(chalk.white('Pool Balance:'));
        console.log(`  ${result.poolBalance.baseTokenPercent.toFixed(1)}% Token`);
        console.log(`  ${result.poolBalance.quoteTokenPercent.toFixed(1)}% ${result.poolBalance.quoteToken}`);
        console.log(`  Status: ${result.poolBalance.isBalanced ? chalk.green('✓ Balanced') : chalk.red('✗ Imbalanced')}`);
        console.log();
      }
      
      // Whitelist info
      if (result.isWhitelisted) {
        console.log(chalk.white('Whitelist Status:'));
        console.log(`  Source: ${result.whitelistSource}`);
        if (result.whitelistReason) {
          console.log(`  Reason: ${result.whitelistReason}`);
        }
      }
      
    } else {
      console.log(chalk.red('✗ Token is INVALID'));
      console.log();
      console.log(chalk.white('Rejection Details:'));
      console.log(`  Reason: ${result.reason}`);
      if (result.rejectionCode) {
        console.log(`  Code: ${result.rejectionCode}`);
      }
      
      // Pool balance info for imbalanced pools
      if (result.poolBalance && result.rejectionCode === 'POOL_IMBALANCED') {
        console.log();
        console.log(chalk.white('Pool Balance:'));
        console.log(`  ${result.poolBalance.baseTokenPercent.toFixed(1)}% Token ${chalk.red('(too high)')}`);
        console.log(`  ${result.poolBalance.quoteTokenPercent.toFixed(1)}% ${result.poolBalance.quoteToken} ${chalk.red('(too low)')}`);
        console.log();
        console.log(chalk.yellow('  ⚠️  Minimum 20% quote token required for safe liquidation'));
      }
      
      // Show valid suffixes for NOT_SUPPORTED_DEX
      if (result.rejectionCode === 'NOT_SUPPORTED_DEX') {
        console.log();
        console.log(chalk.yellow('Supported token types:'));
        console.log('  • PumpFun tokens (address ends with "pump")');
        console.log('  • Bonk/Raydium tokens (address ends with "bonk")');
      }
    }
    
    console.log(chalk.gray('─'.repeat(50)));
    
  } catch (error) {
    console.error(chalk.red('\nError verifying token:'), error);
    process.exit(1);
  }
}

// Run the test
testCustomToken().catch(console.error);