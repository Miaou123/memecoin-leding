#!/usr/bin/env tsx

/**
 * Get Protocol State CLI
 * 
 * Usage:
 *   pnpm --filter scripts get-protocol-state --network devnet
 *   npx tsx scripts/get-protocol-state.ts --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { createClient, printHeader, printInfo, formatSOL } from './cli-utils';

config();

const program = new Command();

program
  .name('get-protocol-state')
  .description('View the current protocol state and statistics')
  .option('-n, --network <network>', 'Network to use (devnet, mainnet, localnet)', 'devnet')
  .option('-k, --keypair <path>', 'Path to keypair file', '../keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('📊 Protocol State');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      
      const { client, connection } = await createClient(options.network, options.keypair);
      
      // Get protocol state
      const protocolState = await client.getProtocolState();
      
      // Get PDAs
      const [protocolStatePDA] = client.getProtocolStatePDA();
      const [treasuryPDA] = client.getTreasuryPDA();
      
      // Get actual treasury balance from chain
      const treasuryBalance = await connection.getBalance(treasuryPDA);
      
      console.log(chalk.blue('\n📍 Addresses:'));
      printInfo('Protocol State PDA', protocolStatePDA.toString());
      printInfo('Treasury PDA', treasuryPDA.toString());
      
      console.log(chalk.blue('\n👤 Admin Configuration:'));
      printInfo('Admin', protocolState.admin);
      printInfo('Buyback Wallet', protocolState.buybackWallet || 'Not set');
      printInfo('Operations Wallet', protocolState.operationsWallet || 'Not set');
      
      console.log(chalk.blue('\n💰 Treasury:'));
      printInfo('Tracked Balance', `${formatSOL(protocolState.treasuryBalance)} SOL`);
      printInfo('Actual Balance', `${formatSOL(treasuryBalance)} SOL`);
      
      console.log(chalk.blue('\n📈 Statistics:'));
      printInfo('Total Loans Created', protocolState.totalLoansCreated.toString());
      printInfo('Active Loans', protocolState.activeLoans?.toString() || 'N/A');
      printInfo('Total Volume', protocolState.totalVolume ? `${formatSOL(protocolState.totalVolume)} SOL` : 'N/A');
      
      console.log(chalk.blue('\n💸 Fee Configuration:'));
      printInfo('Protocol Fee', `${protocolState.protocolFeeBps / 100}%`);
      printInfo('Treasury Fee (Liquidation)', `${protocolState.treasuryFeeBps / 100}%`);
      printInfo('Buyback Fee (Liquidation)', `${protocolState.buybackFeeBps / 100}%`);
      printInfo('Operations Fee (Liquidation)', `${protocolState.operationsFeeBps / 100}%`);
      
      console.log(chalk.blue('\n🔒 Status:'));
      printInfo('Paused', protocolState.paused ? chalk.red('Yes') : chalk.green('No'));
      
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get protocol state:'), error.message);
      process.exit(1);
    }
  });

program.parse();