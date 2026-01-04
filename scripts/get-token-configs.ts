#!/usr/bin/env tsx

/**
 * Get Token Configs CLI
 * 
 * Usage:
 *   pnpm --filter scripts get-token-configs --network devnet
 *   pnpm --filter scripts get-token-configs --mint <TOKEN_MINT> --network devnet
 */

import { config } from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  formatSOL,
  formatTier,
  formatPoolType,
  padRight
} from './cli-utils';

config();

const program = new Command();

program
  .name('get-token-configs')
  .description('View whitelisted tokens and their configurations')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to keypair', '../keys/admin.json')
  .option('-m, --mint <address>', 'Get specific token config by mint address')
  .action(async (options) => {
    try {
      printHeader('🏷️  Token Configurations');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client } = await createClient(options.network, options.keypair);
      
      // Get specific token
      if (options.mint) {
        const mint = new PublicKey(options.mint);
        const tokenConfig = await client.getTokenConfig(mint);
        
        if (!tokenConfig) {
          console.log(chalk.yellow('Token not found or not whitelisted.'));
          return;
        }
        
        printTokenConfig(tokenConfig);
        return;
      }
      
      // Get all token configs
      const tokenConfigs = await client.getAllTokenConfigs();
      
      if (!tokenConfigs || tokenConfigs.length === 0) {
        console.log(chalk.yellow('No whitelisted tokens found.'));
        return;
      }
      
      console.log(chalk.green(`Found ${tokenConfigs.length} whitelisted token(s):\n`));
      
      // Print summary table
      console.log(chalk.blue('─'.repeat(90)));
      console.log(
        chalk.bold(
          padRight('Token Mint', 48) +
          padRight('Tier', 12) +
          padRight('LTV', 10) +
          padRight('Status', 10) +
          'Pool Type'
        )
      );
      console.log(chalk.blue('─'.repeat(90)));
      
      for (const config of tokenConfigs) {
        const tierStr = getTierSimple(config.tier);
        const statusStr = config.enabled ? chalk.green('Active') : chalk.red('Disabled');
        
        console.log(
          padRight(config.mint.slice(0, 44) + '...', 48) +
          padRight(tierStr, 12) +
          padRight(`${config.ltvBps / 100}%`, 10) +
          padRight(statusStr, 10) +
          formatPoolTypeSimple(config.poolType)
        );
      }
      
      console.log(chalk.blue('─'.repeat(90)));
      console.log('');
      
      // Summary
      const activeCount = tokenConfigs.filter(c => c.enabled).length;
      console.log(chalk.blue('📊 Summary:'));
      printInfo('Total Tokens', tokenConfigs.length.toString());
      printInfo('Active Tokens', activeCount.toString());
      printInfo('Disabled Tokens', (tokenConfigs.length - activeCount).toString());
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get token configs:'), error.message);
      process.exit(1);
    }
  });

function printTokenConfig(config: any): void {
  console.log(chalk.blue('📋 Token Configuration:'));
  printInfo('Mint', config.mint);
  printInfo('Tier', formatTier(config.tier));
  printInfo('Pool Account', config.poolAccount);
  printInfo('Pool Type', formatPoolType(config.poolType));
  
  console.log(chalk.blue('\n💰 Lending Parameters:'));
  printInfo('LTV Ratio', `${config.ltvBps / 100}% (${config.ltvBps} bps)`);
  printInfo('Protocol Fee', '2% flat');
  
  console.log(chalk.blue('\n📏 Loan Limits:'));
  printInfo('Min Loan', `${formatSOL(config.minLoanAmount)} SOL`);
  printInfo('Max Loan', `${formatSOL(config.maxLoanAmount)} SOL`);
  
  console.log(chalk.blue('\n🔒 Status:'));
  printInfo('Enabled', config.enabled ? chalk.green('Yes') : chalk.red('No'));
  console.log('');
}

function getTierSimple(tier: any): string {
  if (tier.gold) return '🥇 Gold';
  if (tier.silver) return '🥈 Silver';
  if (tier.bronze) return '🥉 Bronze';
  return 'Unknown';
}

function formatPoolTypeSimple(poolType: any): string {
  if (poolType.raydium) return 'Raydium';
  if (poolType.orca) return 'Orca';
  if (poolType.pumpfun) return 'Pumpfun';
  if (poolType.pumpswap) return 'PumpSwap';
  return 'Unknown';
}

program.parse();