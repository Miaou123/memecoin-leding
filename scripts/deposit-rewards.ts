#!/usr/bin/env tsx

/**
 * Deposit Rewards to Staking Pool
 * 
 * Usage:
 *   npx tsx deposit-rewards.ts --network devnet --amount 10
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
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
  .name('deposit-rewards')
  .description('Deposit SOL rewards to the staking pool')
  .requiredOption('-a, --amount <sol>', 'Amount of SOL to deposit')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to depositor keypair', './keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('💰 Deposit Staking Rewards');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      
      const amount = parseFloat(options.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount');
      }
      
      const lamports = new BN(amount * LAMPORTS_PER_SOL);
      
      // Check depositor balance
      const balance = await connection.getBalance(keypair.publicKey);
      printInfo('Depositor', keypair.publicKey.toString());
      printInfo('Balance', `${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      printInfo('Amount to Deposit', `${amount} SOL`);
      
      if (balance < lamports.toNumber() + 10000) {
        throw new Error('Insufficient balance for deposit + fees');
      }
      
      // Check current staking pool status
      console.log(chalk.blue('\n📊 Current Staking Pool Status:'));
      try {
        const stakingPool = await client.getStakingPool();
        if (stakingPool) {
          printInfo('Total Staked', `${Number(stakingPool.totalStaked) / 1e6} tokens`);
          printInfo('Reward Vault', `${Number(stakingPool.rewardVaultBalance || 0) / LAMPORTS_PER_SOL} SOL`);
          printInfo('Total Distributed', `${Number(stakingPool.totalRewardsDistributed) / LAMPORTS_PER_SOL} SOL`);
          printInfo('Total Deposited', `${Number(stakingPool.totalRewardsDeposited) / LAMPORTS_PER_SOL} SOL`);
        }
      } catch (e) {
        console.log(chalk.yellow('  Could not fetch staking pool status'));
      }
      
      console.log(chalk.yellow('\n⏳ Depositing rewards...'));
      
      const txSignature = await client.depositRewards(lamports);
      
      console.log('');
      printSuccess('Rewards deposited successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      // Show updated status
      console.log(chalk.blue('\n📊 Updated Staking Pool Status:'));
      try {
        const stakingPool = await client.getStakingPool();
        if (stakingPool) {
          printInfo('Total Deposited', `${Number(stakingPool.totalRewardsDeposited) / LAMPORTS_PER_SOL} SOL`);
        }
      } catch (e) {
        // Ignore
      }
      
    } catch (error: any) {
      printError(`Failed to deposit rewards: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();