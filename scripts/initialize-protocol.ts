#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';

config();

// Wallet wrapper for Keypair
class NodeWallet {
  constructor(readonly payer: Keypair) {}

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ('version' in tx) {
      (tx as VersionedTransaction).sign([this.payer]);
    } else {
      (tx as Transaction).partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if ('version' in tx) {
        (tx as VersionedTransaction).sign([this.payer]);
      } else {
        (tx as Transaction).partialSign(this.payer);
      }
      return tx;
    });
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
}

const program = new Command();

program
  .name('initialize-protocol')
  .description('Initialize the memecoin lending protocol')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('-a, --admin <address>', 'Admin address (if different from keypair)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔧 Initializing protocol...'));
      
      // Load network configuration
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Program ID: ${PROGRAM_ID.toString()}`));
      
      // Create connection
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load admin keypair
      if (!fs.existsSync(options.adminKeypair)) {
        throw new Error(`Admin keypair not found: ${options.adminKeypair}`);
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.adminKeypair, 'utf8')))
      );
      
      console.log(chalk.gray(`Admin: ${adminKeypair.publicKey.toString()}`));

      // Load the actual IDL
      const idlPath = '../target/idl/memecoin_lending.json';
      if (!fs.existsSync(idlPath)) {
        throw new Error(`IDL not found: ${idlPath}`);
      }
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

      // Create wallet wrapper
      const wallet = new NodeWallet(adminKeypair);

      const client = new MemecoinLendingClient(
        connection,
        wallet,
        PROGRAM_ID,
        idl
      );
      
      // Initialize protocol
      console.log(chalk.blue('📝 Initializing protocol state...'));
      
      const adminAddress = options.admin 
        ? new PublicKey(options.admin)
        : adminKeypair.publicKey;
      
      const txSignature = await client.initializeProtocol(adminAddress);
      
      console.log(chalk.green('✅ Protocol initialized!'));
      console.log(chalk.gray(`Transaction: ${txSignature}`));
      console.log(chalk.gray(`Admin: ${adminAddress.toString()}`));
      
      // Get protocol state to confirm
      const protocolState = await client.getProtocolState();
      console.log(chalk.green('📊 Protocol State:'));
      console.log(chalk.gray(`  Admin: ${protocolState.admin}`));
      console.log(chalk.gray(`  Paused: ${protocolState.paused}`));
      console.log(chalk.gray(`  Treasury Balance: ${protocolState.treasuryBalance} lamports`));
      
      // Get PDAs for reference
      const [protocolStatePDA] = client.getProtocolStatePDA();
      const [treasuryPDA] = client.getTreasuryPDA();
      
      console.log(chalk.blue('📍 Important Addresses:'));
      console.log(chalk.gray(`  Protocol State: ${protocolStatePDA.toString()}`));
      console.log(chalk.gray(`  Treasury: ${treasuryPDA.toString()}`));
      
      console.log(chalk.green('\n✅ Protocol initialization completed!'));
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.gray('1. Run whitelist-token to add supported memecoins'));
      console.log(chalk.gray('2. Run fund-treasury to add initial liquidity'));
      
    } catch (error) {
      console.error(chalk.red('❌ Initialization failed:'), error);
      process.exit(1);
    }
  });

program.parse();