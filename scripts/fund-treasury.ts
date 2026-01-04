#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { parseNetworkArg, validateNetwork, getNetworkConfig, updateDeployment } from './config.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import chalk from 'chalk';
import { Command } from 'commander';

const program = new Command();

program
  .name('fund-treasury')
  .description('Fund the protocol treasury with SOL')
  .requiredOption('--network <network>', 'Solana network (devnet, mainnet, localnet)')
  .requiredOption('--amount <amount>', 'Amount of SOL to fund (e.g., 10)')
  .option('--admin-keypair <path>', 'Path to admin keypair (defaults to./keys/admin.json)')
  .action(async (options) => {
    try {
      printHeader('Fund Treasury');
      
      // Validate inputs
      validateNetwork(options.network);
      const fundAmount = parseFloat(options.amount);
      if (isNaN(fundAmount) || fundAmount <= 0) {
        throw new Error('Invalid fund amount. Must be a positive number.');
      }
      
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      printInfo('Fund Amount', `${fundAmount} SOL`);
      
      // Create client
      const { client, keypair } = await createClient(options.network, options.adminKeypair);
      
      printInfo('Funder', keypair.publicKey.toString());
      
      const lamports = new BN(Math.floor(fundAmount * LAMPORTS_PER_SOL));
      
      console.log(chalk.yellow('\\n🔄 Sending transaction...'));
      
      // Fund treasury
      const signature = await client.fundTreasury(lamports);
      
      printSuccess('Treasury funded successfully!');
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      // Check treasury balance
      console.log(chalk.yellow('\\n💰 Checking treasury balance...'));
      const protocolState = await client.getProtocolState();
      const treasuryBalanceSOL = protocolState.treasuryBalance / LAMPORTS_PER_SOL;
      printInfo('Treasury Balance', `${treasuryBalanceSOL} SOL`);
      
      // Update deployment config with treasury funding info
      console.log(chalk.yellow('\\n💾 Updating deployment config...'));
      updateDeployment(options.network, {
        initialization: {
          treasury: {
            txSignature: signature,
            timestamp: new Date().toISOString(),
            funded: true,
            balance: treasuryBalanceSOL,
          }
        }
      });
      
      printSuccess('Deployment config updated with treasury funding info');
      
      console.log(chalk.green('\\n✅ Treasury funding complete!'));
      
    } catch (error) {
      printError(`Failed to fund treasury: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);