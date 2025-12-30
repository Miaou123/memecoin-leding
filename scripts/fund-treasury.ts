#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  .name('fund-treasury')
  .description('Fund the protocol treasury with SOL')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --funder-keypair <path>', 'Path to funder keypair', './keys/admin.json')
  .option('-a, --amount <sol>', 'Amount of SOL to fund', '10')
  .action(async (options) => {
    try {
      console.log(chalk.blue('💰 Funding protocol treasury...'));
      
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Amount: ${options.amount} SOL`));
      
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      if (!fs.existsSync(options.funderKeypair)) {
        throw new Error(`Funder keypair not found: ${options.funderKeypair}`);
      }
      
      const funderKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.funderKeypair, 'utf8')))
      );
      
      console.log(chalk.gray(`Funder: ${funderKeypair.publicKey.toString()}`));
      
      const balance = await connection.getBalance(funderKeypair.publicKey);
      const requiredLamports = parseFloat(options.amount) * LAMPORTS_PER_SOL;
      
      console.log(chalk.gray(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`));
      console.log(chalk.gray(`Required: ${requiredLamports / LAMPORTS_PER_SOL} SOL`));
      
      if (balance < requiredLamports) {
        throw new Error('Insufficient balance for funding');
      }
      
      // Load the actual IDL
      const idlPath = path.join(__dirname, '../target/idl/memecoin_lending.json');
      if (!fs.existsSync(idlPath)) {
        throw new Error(`IDL not found: ${idlPath}`);
      }
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

      // Create wallet wrapper
      const wallet = new NodeWallet(funderKeypair);

      const client = new MemecoinLendingClient(
        connection,
        wallet,
        PROGRAM_ID,
        idl
      );
      
      const [treasuryPDA] = client.getTreasuryPDA();
      console.log(chalk.gray(`Treasury: ${treasuryPDA.toString()}`));
      
      const treasuryBalance = await connection.getBalance(treasuryPDA);
      console.log(chalk.gray(`Current treasury balance: ${treasuryBalance / LAMPORTS_PER_SOL} SOL`));
      
      console.log(chalk.blue('📤 Creating funding transaction...'));
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funderKeypair.publicKey,
          toPubkey: treasuryPDA,
          lamports: requiredLamports,
        })
      );
      
      const signature = await connection.sendTransaction(
        transaction,
        [funderKeypair],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );
      
      console.log(chalk.yellow('⏳ Confirming transaction...'));
      
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log(chalk.green('✅ Treasury funded successfully!'));
      console.log(chalk.gray(`Transaction: ${signature}`));
      
      const newTreasuryBalance = await connection.getBalance(treasuryPDA);
      console.log(chalk.green(`New treasury balance: ${newTreasuryBalance / LAMPORTS_PER_SOL} SOL`));
      
      try {
        const protocolState = await client.getProtocolState();
        console.log(chalk.blue('\n📊 Protocol State:'));
        console.log(chalk.gray(`  Admin: ${protocolState.admin}`));
        console.log(chalk.gray(`  Treasury Balance: ${protocolState.treasuryBalance} lamports`));
        console.log(chalk.gray(`  Total Loans Created: ${protocolState.totalLoansCreated}`));
      } catch (error) {
        console.log(chalk.yellow('Could not fetch updated protocol state'));
      }
      
      console.log(chalk.green('\n✅ Treasury funding completed!'));
      
    } catch (error) {
      console.error(chalk.red('❌ Treasury funding failed:'), error);
      process.exit(1);
    }
  });

program.parse();