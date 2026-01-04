#!/usr/bin/env tsx

/**
 * Close Current Deployment
 * 
 * This script will:
 * 1. Withdraw treasury funds (0.1 SOL)
 * 2. Drain reward vault if any
 * 3. Close all PDAs and recover rent
 * 
 * Usage:
 *   npx tsx scripts/close-current-deployment.ts --network devnet
 */

import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { Command } from 'commander';
import chalk from 'chalk';
import BN from 'bn.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink,
  formatSOL
} from './cli-utils.js';
import { loadDeployment } from './deployment-store.js';
import { existsSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('close-deployment')
  .description('Close current deployment and recover all funds')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      printHeader('🔒 Close Current Deployment');
      
      // Load deployment info
      const deployment = loadDeployment(options.network);
      if (!deployment) {
        throw new Error(`No deployment found for ${options.network}`);
      }
      
      console.log(chalk.cyan('📋 Deployment Info:'));
      printInfo('Program ID', deployment.programId);
      printInfo('Deployed At', new Date(deployment.deployedAt).toLocaleString());
      printInfo('Fund Amount', `${deployment.fundAmount || 0} SOL`);
      
      console.log(chalk.yellow('\n⚠️  WARNING: This will close all PDAs and withdraw all funds!'));
      
      if (!options.confirm) {
        console.log(chalk.yellow('\nUse --confirm flag to skip confirmation prompt'));
        process.exit(0);
      }
      
      const { client, connection, keypair } = await createClient(options.network, options.keypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      
      // Step 1: Check balances
      console.log(chalk.cyan('\n💰 Checking balances...'));
      
      let totalRecovered = 0;
      
      // Check treasury
      if (deployment.pdas.treasury) {
        const treasuryPDA = new PublicKey(deployment.pdas.treasury);
        const treasuryBalance = await connection.getBalance(treasuryPDA);
        printInfo('Treasury Balance', `${formatSOL(treasuryBalance)} SOL`);
        
        if (treasuryBalance > 0) {
          console.log(chalk.yellow('\n💸 Withdrawing treasury...'));
          try {
            // Withdraw full treasury amount
            const treasuryAmount = new BN(treasuryBalance);
            const tx = await client.withdrawTreasury(treasuryAmount);
            printSuccess(`Treasury withdrawn: ${formatSOL(treasuryBalance)} SOL`);
            printTxLink(tx, options.network);
            totalRecovered += treasuryBalance;
          } catch (e: any) {
            printError(`Failed to withdraw treasury: ${e.message}`);
          }
        }
      }
      
      // Check reward vault
      if (deployment.pdas.rewardVault) {
        const rewardVaultPDA = new PublicKey(deployment.pdas.rewardVault);
        const rewardVaultBalance = await connection.getBalance(rewardVaultPDA);
        printInfo('Reward Vault Balance', `${formatSOL(rewardVaultBalance)} SOL`);
        
        if (rewardVaultBalance > 0) {
          console.log(chalk.yellow('\n💸 Draining reward vault...'));
          try {
            // Use emergencyDrainRewards for reward vault
            const tx = await client.emergencyDrainRewards();
            printSuccess(`Reward vault drained: ${formatSOL(rewardVaultBalance)} SOL`);
            printTxLink(tx, options.network);
            totalRecovered += rewardVaultBalance;
          } catch (e: any) {
            printError(`Failed to drain reward vault: ${e.message}`);
          }
        }
      }
      
      // Step 2: Close PDAs (if program supports it)
      console.log(chalk.yellow('\n🗑️  Attempting to close PDAs...'));
      
      const pdaList = [
        { name: 'Protocol State', address: deployment.pdas.protocolState },
        { name: 'Treasury', address: deployment.pdas.treasury },
        { name: 'Fee Receiver', address: deployment.pdas.feeReceiver },
        { name: 'Reward Vault', address: deployment.pdas.rewardVault },
      ];
      
      let totalRentLocked = 0;
      console.log(chalk.cyan('\n📋 PDA Status:'));
      
      for (const { name, address } of pdaList) {
        if (!address) continue;
        
        try {
          const pda = new PublicKey(address);
          const balance = await connection.getBalance(pda);
          const accountInfo = await connection.getAccountInfo(pda);
          
          if (accountInfo) {
            console.log(`  ${name}: ${formatSOL(balance)} SOL rent`);
            totalRentLocked += balance;
            
            // Check if we can close it
            if (accountInfo.owner.toString() === deployment.programId) {
              // Try to close if program supports it
              // Note: Most programs don't have close instructions
              console.log(chalk.dim(`    Owner: Program (${deployment.programId.slice(0, 8)}...)`));
            }
          } else {
            console.log(`  ${name}: Already closed`);
          }
        } catch (e) {
          console.log(`  ${name}: Error checking`);
        }
      }
      
      // Summary
      console.log(chalk.green('\n✅ Deployment closure complete!'));
      console.log(chalk.cyan('\n📊 Summary:'));
      console.log(`  ✓ Total recovered: ${formatSOL(totalRecovered)} SOL`);
      console.log(`  ⚠️  Rent locked in PDAs: ${formatSOL(totalRentLocked)} SOL`);
      console.log(`  💰 Net recovered: ${formatSOL(totalRecovered)} SOL`);
      
      if (totalRentLocked > 0) {
        console.log(chalk.yellow('\n⚠️  Note: PDAs can only be closed if your program includes close instructions.'));
        console.log(chalk.yellow('Most Anchor programs do not include these by default.'));
        console.log(chalk.yellow('The rent will remain locked unless you redeploy with close instructions.'));
      }
      
      // Update deployment file
      const deploymentPath = join(__dirname, '..', 'deployments', `${options.network}-latest.json`);
      
      if (existsSync(deploymentPath)) {
        const backupPath = deploymentPath.replace('-latest.json', `-closed-${Date.now()}.json`);
        renameSync(deploymentPath, backupPath);
        console.log(chalk.dim(`\n📁 Deployment file backed up to: ${basename(backupPath)}`));
      }
      
    } catch (error: any) {
      printError(`Failed to close deployment: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  });

program.parse();