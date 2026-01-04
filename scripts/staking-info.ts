#!/usr/bin/env tsx

/**
 * Check Staking Pool Status
 * 
 * Usage:
 *   npx tsx staking-info.ts --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printError
} from './cli-utils.js';

config();

const program = new Command();

program
  .name('staking-info')
  .description('Get staking pool information and statistics')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to keypair', '../keys/admin.json')
  .option('-u, --user <address>', 'Check specific user stake')
  .action(async (options) => {
    try {
      printHeader('🥩 Staking Pool Info');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client, connection } = await createClient(options.network, options.keypair);
      
      // Get staking pool info
      console.log(chalk.blue('📊 Staking Pool Status:\n'));
      
      try {
        const stakingPool = await client.getStakingPool();
        
        if (!stakingPool) {
          console.log(chalk.yellow('  Staking pool not initialized'));
          return;
        }
        
        console.log(chalk.green('  ✓ Staking pool is initialized\n'));
        
        // Basic Info
        console.log(chalk.blue.bold('  Pool Configuration:'));
        printInfo('Authority', stakingPool.authority?.toString() || 'N/A');
        printInfo('Staking Token', stakingPool.stakingTokenMint?.toString() || 'N/A');
        printInfo('Staking Vault', stakingPool.stakingVault?.toString() || 'N/A');
        printInfo('Reward Vault', stakingPool.rewardVault?.toString() || 'N/A');
        printInfo('Paused', stakingPool.paused ? 'Yes' : 'No');
        
        // Stats
        console.log(chalk.blue.bold('\n  Pool Statistics:'));
        const totalStaked = Number(stakingPool.totalStaked || 0);
        const rewardVaultBalance = Number(stakingPool.rewardVaultBalance || 0);
        const totalDistributed = Number(stakingPool.totalRewardsDistributed || 0);
        const totalDeposited = Number(stakingPool.totalRewardsDeposited || 0);
        
        printInfo('Total Staked', `${(totalStaked / 1e6).toLocaleString()} tokens`);
        printInfo('Reward Vault Balance', `${(rewardVaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        printInfo('Total Rewards Deposited', `${(totalDeposited / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        printInfo('Total Rewards Distributed', `${(totalDistributed / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        
        // Emission Rates
        console.log(chalk.blue.bold('\n  Emission Configuration:'));
        printInfo('Target Pool Balance', `${Number(stakingPool.targetPoolBalance || 0) / LAMPORTS_PER_SOL} SOL`);
        printInfo('Base Emission Rate', `${Number(stakingPool.baseEmissionRate || 0) / LAMPORTS_PER_SOL} SOL/sec`);
        printInfo('Max Emission Rate', `${Number(stakingPool.maxEmissionRate || 0) / LAMPORTS_PER_SOL} SOL/sec`);
        printInfo('Min Emission Rate', `${Number(stakingPool.minEmissionRate || 0) / LAMPORTS_PER_SOL} SOL/sec`);
        
        // Calculate APR estimate
        if (totalStaked > 0 && rewardVaultBalance > 0) {
          const baseRate = Number(stakingPool.baseEmissionRate || 0);
          const yearlyEmission = baseRate * 60 * 60 * 24 * 365;
          // Very rough APR estimate
          const stakingTokenDecimals = 6;
          const assumedTokenPrice = 0.001; // Assume 0.001 SOL per token for estimate
          const stakedValue = (totalStaked / Math.pow(10, stakingTokenDecimals)) * assumedTokenPrice * LAMPORTS_PER_SOL;
          const apr = stakedValue > 0 ? (yearlyEmission / stakedValue) * 100 : 0;
          console.log(chalk.blue.bold('\n  APR Estimate:'));
          console.log(chalk.gray(`    (Based on base rate and current stake)`));
          printInfo('Estimated APR', `~${apr.toFixed(1)}%`);
        }
        
        // Get reward vault actual balance
        if (stakingPool.rewardVault) {
          try {
            const rewardVaultPubkey = new PublicKey(stakingPool.rewardVault);
            const actualBalance = await connection.getBalance(rewardVaultPubkey);
            console.log(chalk.blue.bold('\n  Reward Vault On-Chain:'));
            printInfo('Actual Balance', `${(actualBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
          } catch (e) {
            // Ignore
          }
        }
        
      } catch (e: any) {
        if (e.message.includes('Account does not exist')) {
          console.log(chalk.yellow('  Staking pool not initialized'));
          console.log(chalk.gray('\n  Run: npx tsx initialize-staking.ts --network devnet --token-mint <MINT>'));
        } else {
          throw e;
        }
      }
      
      // Check specific user stake if requested
      if (options.user) {
        console.log(chalk.blue.bold('\n👤 User Stake Info:'));
        try {
          const userPubkey = new PublicKey(options.user);
          const userStake = await client.getUserStake(userPubkey);
          
          if (userStake) {
            printInfo('User', options.user);
            printInfo('Staked Amount', `${Number(userStake.stakedAmount) / 1e6} tokens`);
            printInfo('Pending Rewards', `${Number(userStake.pendingRewards) / LAMPORTS_PER_SOL} SOL`);
            printInfo('Last Stake Time', new Date(Number(userStake.lastStakeTime) * 1000).toISOString());
          } else {
            console.log(chalk.yellow(`  No stake found for ${options.user}`));
          }
        } catch (e: any) {
          console.log(chalk.yellow(`  Could not fetch user stake: ${e.message}`));
        }
      }
      
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to get staking info: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();