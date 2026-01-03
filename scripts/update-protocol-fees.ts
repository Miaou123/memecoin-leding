#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { validateNetwork, getNetworkConfig } from './config.js';
import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { Command } from 'commander';


const program = new Command();

program
  .name('update-protocol-fees')
  .description('Update protocol fee configuration')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--protocol-fee <bps>', 'Protocol fee in basis points (200 = 2%)', '200')
  .action(async (options) => {
    try {
      printHeader('Update Protocol Fees');
      
      const protocolFeeBps = parseInt(options.protocolFee);
      
      if (protocolFeeBps > 500) {
        throw new Error('Protocol fee cannot exceed 5% (500 bps)');
      }
      
      // Validate network
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      printInfo('New Protocol Fee', `${protocolFeeBps / 100}%`);
      
      // Create client
      const { client, keypair } = await createClient(options.network, options.adminKeypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      
      // Fetch current protocol state
      const currentState = await client.getProtocolState();
      
      console.log(chalk.blue('\n📊 Current Configuration:'));
      console.log(chalk.gray(`  Protocol Fee: ${currentState.protocolFeeBps / 100}%`));
      
      console.log(chalk.yellow('\n🔄 Sending transaction...'));
      
      // Update fees using the client method
      const signature = await client.updateFees({
        protocolFeeBps: protocolFeeBps,
      });
      
      printSuccess('Protocol fee updated successfully!');
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      console.log(chalk.blue('\n📋 Fee Distribution (2% loan fee):'));
      console.log(chalk.gray('  • 1.0% → Treasury'));
      console.log(chalk.gray('  • 0.5% → Staking Rewards'));
      console.log(chalk.gray('  • 0.5% → Operations'));
      
      console.log(chalk.green('\n✅ Protocol fee update complete!'));
      
    } catch (error: any) {
      printError(`Failed to update fees: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();