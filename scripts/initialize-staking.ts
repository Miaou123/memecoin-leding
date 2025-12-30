#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

// Load IDL
const IDL_PATH = path.join(__dirname, '../target/idl/memecoin_lending.json');

// Wallet wrapper
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
  .name('initialize-staking')
  .description('Initialize the staking pool for governance token staking')
  .requiredOption('-m, --token-mint <address>', 'Governance token mint address')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--target-balance <sol>', 'Target pool balance in SOL for optimal APR', '50')
  .option('--base-rate <lamports>', 'Base emission rate (lamports/second)', '1000000')
  .option('--max-rate <lamports>', 'Max emission rate (lamports/second)', '10000000')
  .option('--min-rate <lamports>', 'Min emission rate (lamports/second)', '100000')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('\n🎯 INITIALIZE STAKING POOL\n'));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Validate token mint
      let stakingTokenMint: PublicKey;
      try {
        stakingTokenMint = new PublicKey(options.tokenMint);
      } catch {
        throw new Error(`Invalid token mint address: ${options.tokenMint}`);
      }
      
      // Load config
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.white(`  Network:     ${options.network}`));
      console.log(chalk.white(`  Token Mint:  ${stakingTokenMint.toString()}`));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Create connection
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load admin keypair
      if (!fs.existsSync(options.adminKeypair)) {
        throw new Error(`Admin keypair not found: ${options.adminKeypair}`);
      }
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.adminKeypair, 'utf8')))
      );
      
      console.log(chalk.gray(`  Admin: ${adminKeypair.publicKey.toString()}`));
      
      // Create provider and program
      const wallet = new NodeWallet(adminKeypair);
      const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
      
      const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
      const programClient = new Program(idl, provider);
      
      // Derive PDAs
      const [stakingPool] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_pool')],
        PROGRAM_ID
      );
      const [stakingVaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_vault')],
        PROGRAM_ID
      );
      const [rewardVault] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault')],
        PROGRAM_ID
      );
      
      // Get associated token address for staking vault
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const stakingVault = await getAssociatedTokenAddress(
        stakingTokenMint,
        stakingVaultAuthority,
        true
      );
      
      console.log(chalk.blue('\n📍 PDAs:'));
      console.log(chalk.gray(`  Staking Pool:   ${stakingPool.toString()}`));
      console.log(chalk.gray(`  Staking Vault:  ${stakingVault.toString()}`));
      console.log(chalk.gray(`  Reward Vault:   ${rewardVault.toString()}`));
      
      // Parse emission parameters
      const targetPoolBalance = new BN(parseFloat(options.targetBalance) * LAMPORTS_PER_SOL);
      const baseEmissionRate = new BN(options.baseRate);
      const maxEmissionRate = new BN(options.maxRate);
      const minEmissionRate = new BN(options.minRate);
      
      console.log(chalk.blue('\n⚙️  Emission Parameters:'));
      console.log(chalk.gray(`  Target Balance:  ${options.targetBalance} SOL`));
      console.log(chalk.gray(`  Base Rate:       ${options.baseRate} lamports/sec`));
      console.log(chalk.gray(`  Max Rate:        ${options.maxRate} lamports/sec`));
      console.log(chalk.gray(`  Min Rate:        ${options.minRate} lamports/sec`));
      
      // Check if already initialized
      try {
        await programClient.account.stakingPool.fetch(stakingPool);
        console.log(chalk.yellow('\n⚠️  Staking pool already initialized!'));
        return;
      } catch {
        // Not initialized, continue
      }
      
      console.log(chalk.yellow('\n⏳ Initializing staking pool...'));
      
      // Initialize staking
      const tx = await programClient.methods
        .initializeStaking(
          targetPoolBalance,
          baseEmissionRate,
          maxEmissionRate,
          minEmissionRate
        )
        .accounts({
          stakingPool,
          stakingTokenMint,
          stakingVault,
          stakingVaultAuthority,
          rewardVault,
          authority: adminKeypair.publicKey,
          tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
          associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
          systemProgram: new PublicKey('11111111111111111111111111111111'),
        })
        .rpc();
      
      console.log(chalk.green('\n✅ Staking pool initialized successfully!'));
      console.log(chalk.gray(`  Transaction: ${tx}`));
      console.log(chalk.cyan(`  Explorer: https://explorer.solana.com/tx/${tx}?cluster=${options.network}`));
      
      console.log(chalk.blue('\n📋 Next Steps:'));
      console.log(chalk.gray('  1. Run initialize-fee-receiver to set up creator fee distribution'));
      console.log(chalk.gray('  2. Run update-fees to set protocol fee to 2%'));
      console.log(chalk.gray('  3. Set fee_receiver PDA as PumpFun creator fee recipient'));
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ Failed to initialize staking:'), error.message);
      if (error.logs) {
        console.error(chalk.gray('\nProgram logs:'));
        error.logs.forEach((log: string) => console.error(chalk.gray(`  ${log}`)));
      }
      process.exit(1);
    }
  });

program.parse();