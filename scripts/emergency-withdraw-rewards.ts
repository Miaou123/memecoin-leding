#!/usr/bin/env tsx

/**
 * Emergency Withdraw Rewards
 * 
 * Transfers all SOL from the reward vault back to admin wallet
 * This is a manual SOL transfer, not through the program
 * 
 * Usage:
 *   npx tsx emergency-withdraw-rewards.ts --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils.js';
import { getRewardVaultPDA } from '@memecoin-lending/config';

config();

const program = new Command();

program
  .name('emergency-withdraw-rewards')
  .description('Emergency withdraw all SOL from reward vault to admin')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('🚨 Emergency Withdraw Rewards');
      
      console.log(chalk.red('⚠️  WARNING: This will drain the entire reward vault!'));
      console.log(chalk.red('⚠️  Stakers will no longer be able to claim rewards after this!'));
      console.log(chalk.yellow(`Network: ${options.network}\n`));
      
      const { keypair, connection } = await createClient(options.network, options.keypair);
      
      // Get reward vault PDA
      const rewardVaultPDA = getRewardVaultPDA();
      if (!rewardVaultPDA) {
        throw new Error('Reward vault PDA not found in deployment');
      }
      
      // Check current balance
      const rewardVaultBalance = await connection.getBalance(rewardVaultPDA);
      const adminBalance = await connection.getBalance(keypair.publicKey);
      
      printInfo('Admin', keypair.publicKey.toString());
      printInfo('Admin Balance', `${(adminBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      printInfo('Reward Vault', rewardVaultPDA.toString());
      printInfo('Reward Vault Balance', `${(rewardVaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      
      if (rewardVaultBalance === 0) {
        console.log(chalk.yellow('\n💡 Reward vault is already empty. Nothing to withdraw.'));
        return;
      }
      
      // Calculate amount to withdraw (leave some lamports for rent)
      const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
      const withdrawAmount = rewardVaultBalance - rentExempt;
      
      if (withdrawAmount <= 0) {
        console.log(chalk.yellow('\n💡 Reward vault only contains rent-exempt balance. Nothing to withdraw.'));
        return;
      }
      
      printInfo('Withdrawing', `${(withdrawAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      printInfo('Leaving for rent', `${(rentExempt / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      
      console.log(chalk.yellow('\n⏳ Creating transfer transaction...'));
      
      // Create transfer instruction from reward vault to admin
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: rewardVaultPDA,
        toPubkey: keypair.publicKey,
        lamports: withdrawAmount,
      });
      
      // Create transaction
      const transaction = new Transaction().add(transferInstruction);
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      
      // Note: This will fail because reward vault is a PDA and we can't sign for it directly
      // We would need the program to do this transfer
      console.log(chalk.red('\n❌ Cannot directly transfer from PDA'));
      console.log(chalk.yellow('💡 The reward vault is a Program Derived Address (PDA)'));
      console.log(chalk.yellow('💡 Only the program can authorize transfers from it'));
      console.log(chalk.yellow('💡 You need to add a "drain_rewards" instruction to the program'));
      
      console.log(chalk.blue('\n🛠️  Alternative Solutions:'));
      console.log(chalk.gray('1. Add emergency_drain_rewards instruction to staking module'));
      console.log(chalk.gray('2. Use the protocol treasury drain (if rewards were sent there)'));
      console.log(chalk.gray('3. Deploy new program version with drain functionality'));
      console.log(chalk.gray('4. Wait for users to claim their rewards naturally'));
      
      console.log(chalk.blue('\n📊 Current Situation:'));
      console.log(chalk.gray(`• Reward vault has ${(rewardVaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`));
      console.log(chalk.gray('• This SOL is locked in the PDA until claimed by users'));
      console.log(chalk.gray('• Or until program adds emergency drain functionality'));
      
    } catch (error: any) {
      printError(`Failed to withdraw rewards: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();