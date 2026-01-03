#!/usr/bin/env tsx

import { createClient, printHeader, printInfo, formatSOL } from './cli-utils.js';
import { parseNetworkArg, validateNetwork, getNetworkConfig } from './config.js';
import chalk from 'chalk';
import { Command } from 'commander';

const program = new Command();

program
  .name('check-protocol')
  .description('Check the current state of the memecoin lending protocol')
  .requiredOption('--network <network>', 'Solana network (devnet, mainnet, localnet)')
  .action(async (options) => {
    try {
      printHeader('Protocol State Check');
      
      // Validate network
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      printInfo('RPC URL', config.rpcUrl);
      
      // Create client (no keypair needed for read-only operations)
      const { client } = await createClient(options.network);
      
      console.log(chalk.yellow('\\n📊 Fetching protocol state...'));
      
      // Get protocol state
      const protocolState = await client.getProtocolState();
      
      console.log(chalk.blue('\\n🏛️  Protocol Configuration'));
      printInfo('Admin', protocolState.admin.toString());
      printInfo('Buyback Wallet', protocolState.buybackWallet.toString());
      printInfo('Operations Wallet', protocolState.operationsWallet.toString());
      printInfo('Paused', protocolState.paused ? chalk.red('YES') : chalk.green('NO'));
      printInfo('Protocol Fee', `${protocolState.protocolFeeBps / 100}% (${protocolState.protocolFeeBps} bps)`);
      
      console.log(chalk.blue('\\n💰 Treasury & Loans'));
      printInfo('Treasury Balance', `${formatSOL(protocolState.treasuryBalance)} SOL`);
      printInfo('Total SOL Borrowed', `${formatSOL(protocolState.totalSolBorrowed)} SOL`);
      printInfo('Total Fees Earned', `${formatSOL(protocolState.totalFeesEarned)} SOL`);
      printInfo('Active Loans', protocolState.activeLoansCount.toString());
      printInfo('Total Loans Created', protocolState.totalLoansCreated.toString());
      
      console.log(chalk.blue('\\n📈 Fee Distribution'));
      printInfo('Treasury Fee Split', `${protocolState.treasuryFeeBps / 100}% (${protocolState.treasuryFeeBps} bps)`);
      printInfo('Buyback Fee Split', `${protocolState.buybackFeeBps / 100}% (${protocolState.buybackFeeBps} bps)`);
      printInfo('Operations Fee Split', `${protocolState.operationsFeeBps / 100}% (${protocolState.operationsFeeBps} bps)`);
      
      // Check if there's a pending admin transfer
      if (protocolState.pendingAdmin && protocolState.pendingAdmin.toString() !== '11111111111111111111111111111111') {
        console.log(chalk.yellow('\\n⏳ Admin Transfer Pending'));
        printInfo('Pending Admin', protocolState.pendingAdmin.toString());
        printInfo('Transfer Timestamp', new Date(protocolState.adminTransferTimestamp * 1000).toISOString());
      }
      
      console.log(chalk.green('\\n✅ Protocol state check complete!'));
      
    } catch (error) {
      console.error(chalk.red(`❌ Failed to check protocol: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);