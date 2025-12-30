#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
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
  .name('initialize-fee-receiver')
  .description('Initialize the fee receiver for creator fee distribution (40/40/20 split)')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--treasury <address>', 'Treasury wallet address (defaults to protocol treasury)')
  .option('--operations <address>', 'Operations wallet address (defaults to protocol operations wallet)')
  .option('--treasury-split <bps>', 'Treasury split in basis points', '4000')
  .option('--staking-split <bps>', 'Staking split in basis points', '4000')
  .option('--operations-split <bps>', 'Operations split in basis points', '2000')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('\n💰 INITIALIZE FEE RECEIVER\n'));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Validate splits sum to 10000
      const treasurySplit = parseInt(options.treasurySplit);
      const stakingSplit = parseInt(options.stakingSplit);
      const operationsSplit = parseInt(options.operationsSplit);
      
      if (treasurySplit + stakingSplit + operationsSplit !== 10000) {
        throw new Error(`Fee splits must sum to 10000. Got: ${treasurySplit + stakingSplit + operationsSplit}`);
      }
      
      // Load config
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.white(`  Network: ${options.network}`));
      console.log(chalk.gray('─'.repeat(50)));
      
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load admin keypair
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
      
      // Derive PDAs
      const [feeReceiver] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_receiver')],
        PROGRAM_ID
      );
      const [rewardVault] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault')],
        PROGRAM_ID
      );
      const [protocolState] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol_state')],
        PROGRAM_ID
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
          PROGRAM_ID
        );
        treasuryWallet = treasury;
      }
      
      if (options.operations) {
        operationsWallet = new PublicKey(options.operations);
      } else {
        // Fetch from protocol state
        const state = await programClient.account.protocolState.fetch(protocolState);
        operationsWallet = state.operationsWallet as PublicKey;
      }
      
      console.log(chalk.blue('\n📍 Configuration:'));
      console.log(chalk.gray(`  Fee Receiver PDA:   ${feeReceiver.toString()}`));
      console.log(chalk.gray(`  Treasury Wallet:    ${treasuryWallet.toString()}`));
      console.log(chalk.gray(`  Operations Wallet:  ${operationsWallet.toString()}`));
      console.log(chalk.gray(`  Staking Reward Vault: ${rewardVault.toString()}`));
      
      console.log(chalk.blue('\n💸 Fee Split (Staker-Focused):'));
      console.log(chalk.green(`  Treasury:   ${treasurySplit / 100}%`));
      console.log(chalk.green(`  Staking:    ${stakingSplit / 100}% ⭐`));
      console.log(chalk.green(`  Operations: ${operationsSplit / 100}%`));
      
      // Check if already initialized
      try {
        await programClient.account.feeReceiver.fetch(feeReceiver);
        console.log(chalk.yellow('\n⚠️  Fee receiver already initialized!'));
        return;
      } catch {
        // Not initialized, continue
      }
      
      console.log(chalk.yellow('\n⏳ Initializing fee receiver...'));
      
      const tx = await programClient.methods
        .initializeFeeReceiver(
          treasurySplit,
          stakingSplit,
          operationsSplit
        )
        .accounts({
          feeReceiver,
          treasuryWallet,
          operationsWallet,
          stakingRewardVault: rewardVault,
          authority: adminKeypair.publicKey,
          systemProgram: new PublicKey('11111111111111111111111111111111'),
        })
        .rpc();
      
      console.log(chalk.green('\n✅ Fee receiver initialized successfully!'));
      console.log(chalk.gray(`  Transaction: ${tx}`));
      console.log(chalk.cyan(`  Explorer: https://explorer.solana.com/tx/${tx}?cluster=${options.network}`));
      
      console.log(chalk.blue.bold('\n🎯 IMPORTANT: Set PumpFun Creator Fee Recipient'));
      console.log(chalk.white(`  When launching your token on PumpFun, set the creator fee recipient to:`));
      console.log(chalk.yellow.bold(`  ${feeReceiver.toString()}`));
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ Failed to initialize fee receiver:'), error.message);
      process.exit(1);
    }
  });

program.parse();