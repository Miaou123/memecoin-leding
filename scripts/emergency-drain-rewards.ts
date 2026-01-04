#!/usr/bin/env tsx

/**
 * Emergency Drain Staking Rewards
 * 
 * Drains all SOL from the staking reward vault back to admin
 * This requires the program to have the emergency_drain_rewards instruction
 * 
 * Usage:
 *   npx tsx emergency-drain-rewards.ts --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils.js';

config();

const program = new Command();

program
  .name('emergency-drain-rewards')
  .description('Emergency drain all SOL from staking reward vault to admin')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('🚨 Emergency Drain Staking Rewards');
      
      console.log(chalk.red('⚠️  WARNING: This will drain the entire reward vault!'));
      console.log(chalk.red('⚠️  Users will no longer be able to claim rewards after this!'));
      console.log(chalk.yellow(`Network: ${options.network}\n`));
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      
      // Check current staking pool status
      console.log(chalk.blue('📊 Current Staking Pool Status:'));
      try {
        const stakingStats = await client.getStakingStats();
        printInfo('Admin', keypair.publicKey.toString());
        printInfo('Total Staked', `${Number(stakingStats.totalStaked) / 1e6} tokens`);
        printInfo('Reward Vault', `${Number(stakingStats.rewardPoolBalance || 0) / LAMPORTS_PER_SOL} SOL`);
        
        const rewardBalance = Number(stakingStats.rewardPoolBalance || 0);
        if (rewardBalance === 0) {
          console.log(chalk.yellow('\n💡 Reward vault is already empty. Nothing to drain.'));
          return;
        }
        
        console.log(chalk.yellow(`\n⏳ Draining ${rewardBalance / LAMPORTS_PER_SOL} SOL from reward vault...`));
        
      } catch (e) {
        console.log(chalk.yellow('  Could not fetch staking pool status, proceeding anyway...'));
      }
      
      // Execute emergency drain
      const txSignature = await client.emergencyDrainRewards();
      
      console.log('');
      printSuccess('Emergency drain completed successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      // Show updated status
      console.log(chalk.blue('\n📊 Updated Status:'));
      try {
        const stakingStats = await client.getStakingStats();
        printInfo('Reward Vault Balance', `${Number(stakingStats.rewardPoolBalance || 0) / LAMPORTS_PER_SOL} SOL`);
      } catch (e) {
        console.log(chalk.gray('  Could not fetch updated status'));
      }
      
      console.log(chalk.green('\n✅ Staking reward vault has been drained!'));
      console.log(chalk.gray('💡 You can now make changes to your staking system'));
      
    } catch (error: any) {
      printError(`Failed to drain rewards: ${error.message}`);
      
      if (error.message.includes('Unauthorized')) {
        console.log(chalk.yellow('\n💡 Only the protocol admin can drain the reward vault'));
        console.log(chalk.yellow('💡 Make sure you are using the correct admin keypair'));
      } else if (error.message.includes('InsufficientRewardBalance')) {
        console.log(chalk.yellow('\n💡 The reward vault is already empty'));
      } else if (error.message.includes('0x65')) {
        console.log(chalk.red('\n💡 The program does not have the emergency_drain_rewards instruction'));
        console.log(chalk.yellow('💡 You need to rebuild and redeploy the program first'));
      }
      
      process.exit(1);
    }
  });

program.parse();