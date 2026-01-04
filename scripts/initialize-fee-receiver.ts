#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { validateNetwork, getNetworkConfig, updateDeployment } from './config.js';
import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { Command } from 'commander';

const program = new Command();

program
  .name('initialize-fee-receiver')
  .description('Initialize the fee receiver for creator fee distribution (40/40/20 split)')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair')
  .option('--treasury <address>', 'Treasury wallet address (defaults to protocol treasury)')
  .option('--operations <address>', 'Operations wallet address (defaults to protocol operations wallet)')
  .option('--treasury-split <bps>', 'Treasury split in basis points', '4000')
  .option('--staking-split <bps>', 'Staking split in basis points', '4000')
  .option('--operations-split <bps>', 'Operations split in basis points', '2000')
  .action(async (options) => {
    try {
      printHeader('Initialize Fee Receiver');
      
      // Validate splits sum to 10000
      const treasurySplit = parseInt(options.treasurySplit);
      const stakingSplit = parseInt(options.stakingSplit);
      const operationsSplit = parseInt(options.operationsSplit);
      
      if (treasurySplit + stakingSplit + operationsSplit !== 10000) {
        throw new Error(`Fee splits must sum to 10000. Got: ${treasurySplit + stakingSplit + operationsSplit}`);
      }
      
      // Validate network
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      
      // Create client
      const { client, keypair } = await createClient(options.network, options.adminKeypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      
      // Derive PDAs
      const [feeReceiver] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_receiver')],
        new PublicKey(config.programId)
      );
      const [rewardVault] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault')],
        new PublicKey(config.programId)
      );
      const [protocolState] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol_state')],
        new PublicKey(config.programId)
      );
      
      // Get treasury and operations wallets from protocol state if not provided
      let treasuryWallet: PublicKey;
      let operationsWallet: PublicKey;
      
      if (options.treasury) {
        treasuryWallet = new PublicKey(options.treasury);
      } else {
        // Use protocol treasury PDA
        const [treasury] = PublicKey.findProgramAddressSync(
          [Buffer.from('treasury')],
          new PublicKey(config.programId)
        );
        treasuryWallet = treasury;
      }
      
      if (options.operations) {
        operationsWallet = new PublicKey(options.operations);
      } else {
        // Fetch from protocol state
        const protocolStateData = await client.getProtocolState();
        operationsWallet = protocolStateData.operationsWallet;
      }
      
      printInfo('Fee Receiver PDA', feeReceiver.toString());
      printInfo('Treasury Wallet', treasuryWallet.toString());
      printInfo('Operations Wallet', operationsWallet.toString());
      printInfo('Staking Reward Vault', rewardVault.toString());
      
      console.log(chalk.blue('\n💸 Fee Split Configuration:'));
      console.log(chalk.green(`  Treasury:   ${treasurySplit / 100}%`));
      console.log(chalk.green(`  Staking:    ${stakingSplit / 100}% ⭐`));
      console.log(chalk.green(`  Operations: ${operationsSplit / 100}%`));
      
      console.log(chalk.yellow('\n🔄 Sending transaction...'));
      
      // Initialize fee receiver
      const signature = await client.initializeFeeReceiver(
        treasuryWallet,
        operationsWallet,
        treasurySplit,
        stakingSplit,
        operationsSplit
      );
      
      printSuccess('Fee receiver initialized successfully!');
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      // Update deployment config with fee receiver info
      console.log(chalk.yellow('\n💾 Updating deployment config...'));
      updateDeployment(options.network, {
        pdas: {
          feeReceiver: feeReceiver.toString(),
          rewardVault: rewardVault.toString(),
        },
        initialization: {
          feeReceiver: {
            txSignature: signature,
            timestamp: new Date().toISOString(),
          }
        }
      });
      
      printSuccess('Deployment config updated with fee receiver addresses');
      
      console.log(chalk.blue.bold('\n🎯 IMPORTANT: Set PumpFun Creator Fee Recipient'));
      console.log(chalk.white(`  When launching your token on PumpFun, set the creator fee recipient to:`));
      console.log(chalk.yellow.bold(`  ${feeReceiver.toString()}`));
      
      console.log(chalk.green('\n✅ Fee receiver initialization complete!'));
      
    } catch (error: any) {
      printError(`Failed to initialize fee receiver: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();