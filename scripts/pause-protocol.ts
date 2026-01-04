#!/usr/bin/env tsx

/**
 * Pause Protocol CLI
 * 
 * Usage:
 *   pnpm --filter scripts pause-protocol --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils';

config();

const program = new Command();

program
  .name('pause-protocol')
  .description('Pause the protocol (admin only) - prevents new loans')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('⏸️  Pause Protocol');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client, keypair } = await createClient(options.network, options.keypair);
      
      // Check current state
      const protocolState = await client.getProtocolState();
      
      if (protocolState.paused) {
        console.log(chalk.yellow('⚠️  Protocol is already paused.'));
        return;
      }
      
      // Verify admin
      if (protocolState.admin !== keypair.publicKey.toString()) {
        throw new Error(
          `You are not the protocol admin.\n` +
          `  Admin: ${protocolState.admin}\n` +
          `  Your wallet: ${keypair.publicKey.toString()}`
        );
      }
      
      console.log(chalk.blue('📊 Current State:'));
      printInfo('Admin', protocolState.admin);
      printInfo('Paused', chalk.green('No'));
      printInfo('Active Loans', protocolState.activeLoans?.toString() || 'N/A');
      
      console.log(chalk.yellow('\n⏳ Pausing protocol...'));
      
      const txSignature = await client.pauseProtocol();
      
      console.log('');
      printSuccess('Protocol paused successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      console.log(chalk.yellow('\n⚠️  The protocol is now paused:'));
      console.log(chalk.gray('   • No new loans can be created'));
      console.log(chalk.gray('   • Existing loans can still be repaid'));
      console.log(chalk.gray('   • Liquidations can still occur'));
      console.log(chalk.gray('   • Use resume-protocol to unpause'));
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to pause protocol: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();