#!/usr/bin/env tsx

/**
 * Update Token Config CLI
 * 
 * Usage:
 *   pnpm --filter scripts update-token-config --mint <TOKEN_MINT> --ltv 6500 --network devnet
 *   pnpm --filter scripts update-token-config --mint <TOKEN_MINT> --disable --network devnet
 */

import { config } from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink,
  formatTier,
  formatPoolType,
  formatSOL
} from './cli-utils';

config();

const program = new Command();

program
  .name('update-token-config')
  .description('Update token configuration (admin only)')
  .requiredOption('-m, --mint <address>', 'Token mint address')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--ltv <bps>', 'New LTV ratio in basis points (e.g., 7000 = 70%)')
  .option('--interest <bps>', 'New interest rate in basis points (e.g., 500 = 5% APR)')
  .option('--enable', 'Enable the token for lending')
  .option('--disable', 'Disable the token for lending')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('🏷️  Update Token Config');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Token Mint: ${options.mint}\n`));
      
      const { client, keypair } = await createClient(options.network, options.keypair);
      const mint = new PublicKey(options.mint);
      
      // Get protocol state to verify admin
      const protocolState = await client.getProtocolState();
      
      if (protocolState.admin !== keypair.publicKey.toString()) {
        throw new Error(
          `You are not the protocol admin.\n` +
          `  Admin: ${protocolState.admin}\n` +
          `  Your wallet: ${keypair.publicKey.toString()}`
        );
      }
      
      // Get current token config
      const tokenConfig = await client.getTokenConfig(mint);
      
      if (!tokenConfig) {
        throw new Error('Token is not whitelisted. Use whitelist-token first.');
      }
      
      console.log(chalk.blue('📊 Current Configuration:'));
      printInfo('Mint', tokenConfig.mint);
      printInfo('Tier', formatTier(tokenConfig.tier));
      printInfo('Pool', tokenConfig.poolAccount);
      printInfo('Pool Type', formatPoolType(tokenConfig.poolType));
      printInfo('LTV', `${tokenConfig.ltvBps / 100}% (${tokenConfig.ltvBps} bps)`);
      printInfo('Interest Rate', `${tokenConfig.interestRateBps / 100}% APR (${tokenConfig.interestRateBps} bps)`);
      printInfo('Liquidation Bonus', `${tokenConfig.liquidationBonusBps / 100}% (${tokenConfig.liquidationBonusBps} bps)`);
      printInfo('Min Loan', `${formatSOL(tokenConfig.minLoanAmount)} SOL`);
      printInfo('Max Loan', `${formatSOL(tokenConfig.maxLoanAmount)} SOL`);
      printInfo('Enabled', tokenConfig.enabled ? chalk.green('Yes') : chalk.red('No'));
      
      // Determine new values
      const newEnabled = options.enable ? true : options.disable ? false : null;
      const newLtv = options.ltv !== undefined ? parseInt(options.ltv) : null;
      const newInterest = options.interest !== undefined ? parseInt(options.interest) : null;
      
      if (newEnabled === null && newLtv === null && newInterest === null) {
        console.log(chalk.yellow('\n⚠️  No changes specified.'));
        console.log(chalk.gray('Use --ltv, --interest, --enable, or --disable to specify changes.'));
        return;
      }
      
      // Validate LTV
      if (newLtv !== null) {
        if (newLtv < 1000 || newLtv > 9000) {
          throw new Error('LTV must be between 10% (1000 bps) and 90% (9000 bps)');
        }
      }
      
      // Validate interest
      if (newInterest !== null) {
        if (newInterest < 0 || newInterest > 5000) {
          throw new Error('Interest rate must be between 0% and 50% (5000 bps)');
        }
      }
      
      console.log(chalk.blue('\n📋 Changes:'));
      if (newEnabled !== null) {
        printInfo('Enabled', newEnabled ? chalk.green('Yes') + ' ← CHANGED' : chalk.red('No') + ' ← CHANGED');
      }
      if (newLtv !== null) {
        printInfo('LTV', `${newLtv / 100}% (${newLtv} bps) ← CHANGED`);
      }
      if (newInterest !== null) {
        printInfo('Interest Rate', `${newInterest / 100}% APR (${newInterest} bps) ← CHANGED`);
      }
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Transaction not executed'));
        return;
      }
      
      console.log(chalk.yellow('\n⏳ Updating token config...'));
      
      const txSignature = await client.updateTokenConfig(mint, {
        enabled: newEnabled ?? undefined,
        ltvBps: newLtv ?? undefined,
        interestRateBps: newInterest ?? undefined,
      });
      
      console.log('');
      printSuccess('Token config updated successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to update token config: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();