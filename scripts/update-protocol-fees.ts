#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const IDL_PATH = path.join(__dirname, '../target/idl/memecoin_lending.json');

class NodeWallet {
  constructor(readonly payer: Keypair) {}
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ('version' in tx) { (tx as VersionedTransaction).sign([this.payer]); }
    else { (tx as Transaction).partialSign(this.payer); }
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if ('version' in tx) { (tx as VersionedTransaction).sign([this.payer]); }
      else { (tx as Transaction).partialSign(this.payer); }
      return tx;
    });
  }
  get publicKey(): PublicKey { return this.payer.publicKey; }
}

const program = new Command();

program
  .name('update-protocol-fees')
  .description('Update protocol fee configuration')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--protocol-fee <bps>', 'Protocol fee in basis points (200 = 2%)', '200')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('\n⚙️  UPDATE PROTOCOL FEES\n'));
      console.log(chalk.gray('─'.repeat(50)));
      
      const protocolFeeBps = parseInt(options.protocolFee);
      
      if (protocolFeeBps > 500) {
        throw new Error('Protocol fee cannot exceed 5% (500 bps)');
      }
      
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.white(`  Network: ${options.network}`));
      console.log(chalk.white(`  New Protocol Fee: ${protocolFeeBps / 100}%`));
      console.log(chalk.gray('─'.repeat(50)));
      
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      if (!fs.existsSync(options.adminKeypair)) {
        throw new Error(`Admin keypair not found: ${options.adminKeypair}`);
      }
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.adminKeypair, 'utf8')))
      );
      
      const wallet = new NodeWallet(adminKeypair);
      const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
      const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
      const programClient = new Program(idl, provider);
      
      const [protocolState] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol_state')],
        PROGRAM_ID
      );
      
      // Fetch current state
      const state = await programClient.account.protocolState.fetch(protocolState);
      
      console.log(chalk.blue('\n📊 Current Configuration:'));
      console.log(chalk.gray(`  Protocol Fee: ${state.protocolFeeBps / 100}%`));
      
      console.log(chalk.yellow('\n⏳ Updating protocol fee...'));
      
      const tx = await programClient.methods
        .updateFees(
          protocolFeeBps,  // protocol_fee_bps
          null,            // treasury_fee_bps (unchanged)
          null,            // buyback_fee_bps (unchanged)
          null             // operations_fee_bps (unchanged)
        )
        .accounts({
          protocolState,
          admin: adminKeypair.publicKey,
        })
        .rpc();
      
      console.log(chalk.green('\n✅ Protocol fee updated successfully!'));
      console.log(chalk.gray(`  Transaction: ${tx}`));
      console.log(chalk.cyan(`  Explorer: https://explorer.solana.com/tx/${tx}?cluster=${options.network}`));
      
      console.log(chalk.blue('\n📋 Fee Distribution (2% loan fee):'));
      console.log(chalk.gray('  • 1.0% → Treasury'));
      console.log(chalk.gray('  • 0.5% → Staking Rewards'));
      console.log(chalk.gray('  • 0.5% → Operations'));
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ Failed to update fees:'), error.message);
      process.exit(1);
    }
  });

program.parse();