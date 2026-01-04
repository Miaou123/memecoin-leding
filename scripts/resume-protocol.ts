#!/usr/bin/env tsx

/**
 * Resume Protocol CLI
 * 
 * Usage:
 *   pnpm --filter scripts resume-protocol --network devnet
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
  .name('resume-protocol')
  .description('Resume the protocol (admin only) - allows new loans')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('▶️  Resume Protocol');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client, keypair } = await createClient(options.network, options.keypair);
      
      // Check current state
      const protocolState = await client.getProtocolState();
      
      if (!protocolState.paused) {
        console.log(chalk.yellow('⚠️  Protocol is not paused.'));
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
      printInfo('Paused', chalk.red('Yes'));
      
      console.log(chalk.yellow('\n⏳ Resuming protocol...'));
      
      const txSignature = await client.resumeProtocol();
      
      console.log('');
      printSuccess('Protocol resumed successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      console.log(chalk.green('\n✅ The protocol is now active:'));
      console.log(chalk.gray('   • New loans can be created'));
      console.log(chalk.gray('   • All normal operations restored'));
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to resume protocol: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();