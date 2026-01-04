#!/usr/bin/env tsx

/**
 * Emergency Protocol Shutdown
 * 
 * This script will:
 * 1. Withdraw all treasury funds
 * 2. Drain staking reward vault
 * 3. Close all PDAs and return rent to admin
 * 
 * ⚠️  WARNING: This will permanently shut down the protocol!
 * 
 * Usage:
 *   npx tsx emergency-shutdown.ts --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils.js';
import { getProtocolStatePDA, getTreasuryPDA, getStakingPoolPDA, getRewardVaultPDA } from '@memecoin-lending/config';

config();

const program = new Command();

program
  .name('emergency-shutdown')
  .description('Emergency shutdown - withdraw all funds and close all PDAs')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      printHeader('🚨 EMERGENCY PROTOCOL SHUTDOWN');
      
      console.log(chalk.red.bold('\n⚠️  CRITICAL WARNING ⚠️'));
      console.log(chalk.yellow('This script will:'));
      console.log(chalk.yellow('  1. Withdraw ALL treasury funds'));
      console.log(chalk.yellow('  2. Drain ALL staking reward vault funds'));
      console.log(chalk.yellow('  3. Close ALL protocol PDAs'));
      console.log(chalk.yellow('  4. Return ALL rent to admin wallet'));
      console.log(chalk.red.bold('\nTHIS ACTION IS IRREVERSIBLE!\n'));
      
      if (!options.confirm) {
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>((resolve) => {
          readline.question(chalk.yellow('Type "SHUTDOWN" to confirm: '), resolve);
        });
        readline.close();
        
        if (answer !== 'SHUTDOWN') {
          console.log(chalk.green('\n✅ Shutdown cancelled.'));
          process.exit(0);
        }
      }
      
      const { client, connection, keypair } = await createClient(options.network, options.keypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      console.log('');
      
      // Step 1: Check protocol state and balances
      console.log(chalk.cyan('📊 Checking protocol state...'));
      const protocolStatePDA = getProtocolStatePDA();
      if (!protocolStatePDA) throw new Error('Protocol state PDA not found');
      const protocolState = await client.program.account.protocolState.fetch(protocolStatePDA);
      
      const treasuryPDA = getTreasuryPDA();
      if (!treasuryPDA) throw new Error('Treasury PDA not found');
      const treasuryBalance = await connection.getBalance(treasuryPDA);
      printInfo('Treasury Balance', `${treasuryBalance / LAMPORTS_PER_SOL} SOL`);
      
      // Check staking reward vault
      const stakingPoolPDA = getStakingPoolPDA();
      const rewardVaultPDA = getRewardVaultPDA();
      let rewardVaultBalance = 0;
      try {
        if (stakingPoolPDA && rewardVaultPDA) {
          const stakingPool = await client.program.account.stakingPool.fetch(stakingPoolPDA);
          rewardVaultBalance = await connection.getBalance(rewardVaultPDA);
          printInfo('Reward Vault Balance', `${rewardVaultBalance / LAMPORTS_PER_SOL} SOL`);
        }
      } catch (e) {
        console.log(chalk.yellow('⚠️  Staking pool not found or already closed'));
      }
      
      // Step 2: Emergency drain treasury
      if (treasuryBalance > 0) {
        console.log(chalk.yellow('\n💸 Draining treasury...'));
        try {
          const tx = await client.emergencyDrain();
          printSuccess(`Treasury drained: ${treasuryBalance / LAMPORTS_PER_SOL} SOL`);
          printTxLink(tx, options.network);
        } catch (e: any) {
          printError(`Failed to drain treasury: ${e.message}`);
        }
      }
      
      // Step 3: Emergency drain staking rewards
      if (rewardVaultBalance > 0) {
        console.log(chalk.yellow('\n💸 Draining staking reward vault...'));
        try {
          const tx = await client.emergencyDrainRewards();
          printSuccess(`Reward vault drained: ${rewardVaultBalance / LAMPORTS_PER_SOL} SOL`);
          printTxLink(tx, options.network);
        } catch (e: any) {
          printError(`Failed to drain reward vault: ${e.message}`);
        }
      }
      
      // Step 4: Close PDAs (this would need custom instructions in your program)
      console.log(chalk.yellow('\n🗑️  Closing PDAs...'));
      console.log(chalk.dim('Note: PDAs can only be closed if the program supports it.'));
      console.log(chalk.dim('Most Anchor programs don\'t include close instructions by default.'));
      console.log(chalk.dim('Rent will remain locked in PDAs unless you have close instructions.'));
      
      // List all PDAs that would need closing
      const pdaList = [
        { name: 'Protocol State', pda: protocolStatePDA },
        { name: 'Treasury', pda: treasuryPDA },
      ];
      
      if (stakingPoolPDA) {
        pdaList.push({ name: 'Staking Pool', pda: stakingPoolPDA });
      }
      if (rewardVaultPDA) {
        pdaList.push({ name: 'Reward Vault', pda: rewardVaultPDA });
      }
      
      console.log(chalk.cyan('\n📋 PDAs in the protocol:'));
      for (const { name, pda } of pdaList) {
        const balance = await connection.getBalance(pda);
        console.log(`  ${name}: ${pda.toString()} (${balance / LAMPORTS_PER_SOL} SOL rent)`);
      }
      
      // Calculate total rent locked
      let totalRent = 0;
      for (const { pda } of pdaList) {
        totalRent += await connection.getBalance(pda);
      }
      
      console.log(chalk.yellow(`\n💰 Total rent locked in PDAs: ${totalRent / LAMPORTS_PER_SOL} SOL`));
      
      // Final summary
      console.log(chalk.green('\n✅ Emergency shutdown complete!'));
      console.log(chalk.cyan('\n📋 Summary:'));
      console.log(`  ✓ Treasury drained: ${treasuryBalance / LAMPORTS_PER_SOL} SOL`);
      console.log(`  ✓ Reward vault drained: ${rewardVaultBalance / LAMPORTS_PER_SOL} SOL`);
      console.log(`  ✓ Total recovered: ${(treasuryBalance + rewardVaultBalance) / LAMPORTS_PER_SOL} SOL`);
      console.log(`  ⚠️  Rent locked in PDAs: ${totalRent / LAMPORTS_PER_SOL} SOL`);
      
      console.log(chalk.yellow('\n🔄 Next steps for fresh deployment:'));
      console.log('  1. Generate a new program keypair: solana-keygen new -o new-program-keypair.json');
      console.log('  2. Update Anchor.toml with the new program ID');
      console.log('  3. Update lib.rs declare_id! with the new program ID');
      console.log('  4. Run: anchor build');
      console.log('  5. Run: anchor deploy');
      console.log('  6. Initialize the new deployment');
      
    } catch (error: any) {
      printError(`Emergency shutdown failed: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  });

program.parse();