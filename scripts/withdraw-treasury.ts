#!/usr/bin/env tsx

/**
 * Withdraw Treasury CLI
 * 
 * Usage:
 *   pnpm --filter scripts withdraw-treasury --amount 10 --network devnet
 */

import { config } from 'dotenv';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Command } from 'commander';
import BN from 'bn.js';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink,
  formatSOL
} from './cli-utils';

config();

const program = new Command();

program
  .name('withdraw-treasury')
  .description('Withdraw SOL from the protocol treasury (admin only)')
  .requiredOption('-a, --amount <sol>', 'Amount of SOL to withdraw')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('💰 Withdraw Treasury');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Amount: ${options.amount} SOL\n`));
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      
      // Get protocol state
      const protocolState = await client.getProtocolState();
      
      // Verify admin
      if (protocolState.admin !== keypair.publicKey.toString()) {
        throw new Error(
          `You are not the protocol admin.\n` +
          `  Admin: ${protocolState.admin}\n` +
          `  Your wallet: ${keypair.publicKey.toString()}`
        );
      }
      
      // Get treasury balance
      const [treasuryPDA] = client.getTreasuryPDA();
      const treasuryBalance = await connection.getBalance(treasuryPDA);
      
      console.log(chalk.blue('📊 Treasury Status:'));
      printInfo('Treasury PDA', treasuryPDA.toString());
      printInfo('Tracked Balance', `${formatSOL(protocolState.treasuryBalance)} SOL`);
      printInfo('Actual Balance', `${formatSOL(treasuryBalance)} SOL`);
      
      // Calculate withdrawal amount
      const withdrawAmount = new BN(parseFloat(options.amount) * LAMPORTS_PER_SOL);
      
      printInfo('Withdrawal Amount', `${formatSOL(withdrawAmount.toString())} SOL`);
      
      // Validate
      if (withdrawAmount.toNumber() > treasuryBalance) {
        throw new Error(
          `Insufficient treasury balance.\n` +
          `  Available: ${formatSOL(treasuryBalance)} SOL\n` +
          `  Requested: ${formatSOL(withdrawAmount.toString())} SOL`
        );
      }
      
      // Check minimum reserve (keep 0.01 SOL for rent)
      const minReserve = 0.01 * LAMPORTS_PER_SOL;
      if (treasuryBalance - withdrawAmount.toNumber() < minReserve) {
        console.log(chalk.yellow(`\n⚠️  Warning: This will leave less than 0.01 SOL in treasury.`));
      }
      
      const remainingBalance = treasuryBalance - withdrawAmount.toNumber();
      printInfo('Remaining Balance', `${formatSOL(remainingBalance)} SOL`);
      
      console.log(chalk.blue('\n👤 Recipient:'));
      printInfo('Admin Wallet', keypair.publicKey.toString());
      
      const adminBalance = await connection.getBalance(keypair.publicKey);
      printInfo('Current Balance', `${formatSOL(adminBalance)} SOL`);
      printInfo('After Withdrawal', `${formatSOL(adminBalance + withdrawAmount.toNumber())} SOL`);
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Transaction not executed'));
        return;
      }
      
      console.log(chalk.yellow('\n⏳ Withdrawing from treasury...'));
      
      const txSignature = await client.withdrawTreasury(withdrawAmount);
      
      console.log('');
      printSuccess('Treasury withdrawal successful!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      // Show updated balance
      const newTreasuryBalance = await connection.getBalance(treasuryPDA);
      const newAdminBalance = await connection.getBalance(keypair.publicKey);
      
      console.log(chalk.blue('\n📊 Updated Balances:'));
      printInfo('Treasury Balance', `${formatSOL(newTreasuryBalance)} SOL`);
      printInfo('Admin Balance', `${formatSOL(newAdminBalance)} SOL`);
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to withdraw from treasury: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();