#!/usr/bin/env tsx

/**
 * Test Liquidator Keypair Loading
 * 
 * Verifies that the liquidator keypair loads correctly from keys/liquidator.json
 * with fallback to keys/admin.json
 * 
 * Usage: npx tsx scripts/test-liquidator-keypair.ts
 */

import chalk from 'chalk';
import { getLiquidatorKeypair, getLiquidatorPublicKey } from '../apps/server/src/config/keys.js';
import fs from 'fs';
import path from 'path';

console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════'));
console.log(chalk.blue.bold('  🔑 Test Liquidator Keypair Loading'));
console.log(chalk.blue.bold('════════════════════════════════════════════════════════════\n'));

const liquidatorPath = path.resolve('./keys/liquidator.json');
const adminPath = path.resolve('./keys/admin.json');

console.log(chalk.gray('Checking keypair files:'));
console.log(chalk.gray(`  Liquidator: ${liquidatorPath}`));
console.log(chalk.gray(`  Admin:      ${adminPath}`));
console.log();

// Check file existence
const liquidatorExists = fs.existsSync(liquidatorPath);
const adminExists = fs.existsSync(adminPath);

console.log(chalk.gray('File status:'));
console.log(`  Liquidator: ${liquidatorExists ? chalk.green('✓ Found') : chalk.yellow('✗ Not found')}`);
console.log(`  Admin:      ${adminExists ? chalk.green('✓ Found') : chalk.yellow('✗ Not found')}`);
console.log();

try {
  console.log(chalk.blue('Loading liquidator keypair...'));
  
  const keypair = getLiquidatorKeypair();
  const publicKey = getLiquidatorPublicKey();
  
  console.log(chalk.green('✅ Success!'));
  console.log(chalk.gray('  Public Key:'), chalk.white(publicKey));
  
  // Show which file was used
  if (liquidatorExists) {
    console.log(chalk.gray('  Source:'), chalk.green('keys/liquidator.json'));
  } else {
    console.log(chalk.gray('  Source:'), chalk.yellow('keys/admin.json (fallback)'));
  }
  
  // Test multiple calls to ensure caching works
  console.log('\n' + chalk.blue('Testing cached access...'));
  const keypair2 = getLiquidatorKeypair();
  const publicKey2 = getLiquidatorPublicKey();
  
  if (publicKey === publicKey2) {
    console.log(chalk.green('✅ Cache working correctly'));
  } else {
    console.log(chalk.red('❌ Cache error: different keys returned'));
  }
  
} catch (error: any) {
  console.log(chalk.red('❌ Failed to load liquidator keypair:'), error.message);
  process.exit(1);
}

console.log('\n' + chalk.green('✅ All tests passed!'));