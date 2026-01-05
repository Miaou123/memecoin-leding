#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { parseNetworkArg, validateNetwork, getNetworkConfig, updateDeployment } from './config.js';
import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { Command } from 'commander';

const program = new Command();

program
  .name('initialize-protocol')
  .description('Initialize the memecoin lending protocol')
  .requiredOption('--network <network>', 'Solana network (devnet, mainnet, localnet)')
  .option('--admin <address>', 'Admin wallet address (defaults to keypair public key)')
  .option('--buyback-wallet <address>', 'Buyback wallet address (defaults to admin)')
  .option('--operations-wallet <address>', 'Operations wallet address (defaults to admin)')
  .option('--liquidator <address>', 'Authorized liquidator address (defaults to admin)')
  .option('--price-authority <address>', 'Price authority address (defaults to admin)')
  .option('--admin-keypair <path>', 'Path to admin keypair (defaults to./keys/admin.json)')
  .action(async (options) => {
    try {
      printHeader('Initialize Protocol');
      
      // Validate network
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      printInfo('RPC URL', config.rpcUrl);
      
      // Create client
      const { client, keypair, connection } = await createClient(options.network, options.adminKeypair);
      
      const adminPubkey = options.admin ? new PublicKey(options.admin) : keypair.publicKey;
      const buybackWallet = options.buybackWallet ? new PublicKey(options.buybackWallet) : adminPubkey;
      const operationsWallet = options.operationsWallet ? new PublicKey(options.operationsWallet) : adminPubkey;
      const authorizedLiquidator = options.liquidator ? new PublicKey(options.liquidator) : adminPubkey;
      const priceAuthority = options.priceAuthority ? new PublicKey(options.priceAuthority) : adminPubkey;
      
      printInfo('Admin', adminPubkey.toString());
      printInfo('Buyback Wallet', buybackWallet.toString());
      printInfo('Operations Wallet', operationsWallet.toString());
      printInfo('Authorized Liquidator', authorizedLiquidator.toString());
      printInfo('Price Authority', priceAuthority.toString());
      
      console.log(chalk.yellow('\\n🔄 Sending transaction...'));
      
      // Initialize protocol
      const signature = await client.initializeProtocol(
        adminPubkey,
        buybackWallet,
        operationsWallet,
        authorizedLiquidator,
        priceAuthority
      );
      
      printSuccess(`Protocol initialized!`);
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      // Check protocol state and derive PDAs
      console.log(chalk.yellow('\\n📊 Verifying protocol state...'));
      const protocolState = await client.getProtocolState();
      
      // Derive protocol PDAs
      const [protocolStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol_state')],
        new PublicKey(config.programId)
      );
      
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('treasury')],
        new PublicKey(config.programId)
      );
      
      printInfo('Protocol Admin', protocolState.admin.toString());
      printInfo('Buyback Wallet', protocolState.buybackWallet.toString());
      printInfo('Operations Wallet', protocolState.operationsWallet.toString());
      printInfo('Protocol Fee', `${protocolState.protocolFeeBps / 100}%`);
      printInfo('Paused', protocolState.paused.toString());
      
      // Save initialization info to deployment config
      console.log(chalk.yellow('\\n💾 Updating deployment config...'));
      updateDeployment(options.network, {
        pdas: {
          protocolState: protocolStatePda.toString(),
          treasury: treasuryPda.toString(),
        },
        initialization: {
          protocol: {
            txSignature: signature,
            timestamp: new Date().toISOString(),
            admin: adminPubkey.toString(),
          }
        }
      });
      
      printSuccess('Deployment config updated with protocol addresses');
      printInfo('Protocol State PDA', protocolStatePda.toString());
      printInfo('Treasury PDA', treasuryPda.toString());
      
      console.log(chalk.green('\\n✅ Protocol initialization complete!'));
      
    } catch (error) {
      printError(`Failed to initialize protocol: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);