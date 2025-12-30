#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import { Command } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const program = new Command();

program
  .name('distribute-fees')
  .description('Distribute accumulated fees in FeeReceiver PDA (40/40/20)')
  .option('-n, --network <network>', 'Network', 'devnet')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('\n📊 DISTRIBUTE ACCUMULATED FEES\n'));
      
      const networkConfig = getNetworkConfig(options.network as any);
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load admin
      const adminPath = path.join(__dirname, '../keys/admin.json');
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(adminPath, 'utf8')))
      );
      
      // Load program
      const idlPath = path.join(__dirname, '../target/idl/memecoin_lending.json');
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
      const wallet = new Wallet(adminKeypair);
      const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
      const anchorProgram = new Program(idl, provider);
      
      // Derive PDAs
      const programId = new PublicKey(PROGRAM_ID);
      
      const [feeReceiverPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_receiver')],
        programId
      );
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('treasury')],
        programId
      );
      const [rewardVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault')],
        programId
      );
      const [protocolStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('protocol_state')],
        programId
      );
      
      // Get operations wallet
      const protocolState = await (anchorProgram.account as any).protocolState.fetch(protocolStatePda);
      const operationsWallet = protocolState.operationsWallet;
      
      // Check FeeReceiver balance
      const feeReceiverBalance = await connection.getBalance(feeReceiverPda);
      const rent = await connection.getMinimumBalanceForRentExemption(200); // Approximate
      const distributable = feeReceiverBalance - rent;
      
      console.log(chalk.gray(`FeeReceiver balance: ${(feeReceiverBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      console.log(chalk.gray(`Rent exempt minimum: ${(rent / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      console.log(chalk.white(`Distributable: ${(distributable / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      
      if (distributable <= 0) {
        console.log(chalk.yellow('\n⚠️  Nothing to distribute'));
        return;
      }
      
      // Distribute
      console.log(chalk.yellow('\n⏳ Distributing...'));
      
      const sig = await anchorProgram.methods
        .distributeCreatorFees()
        .accounts({
          feeReceiver: feeReceiverPda,
          treasuryWallet: treasuryPda,
          operationsWallet: operationsWallet,
          stakingRewardVault: rewardVaultPda,
          caller: adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      const amount = distributable / LAMPORTS_PER_SOL;
      console.log(chalk.green('\n✅ Fees distributed!'));
      console.log(chalk.gray(`  Transaction: ${sig}`));
      console.log(chalk.gray(`  → Treasury (40%):   ${(amount * 0.4).toFixed(6)} SOL`));
      console.log(chalk.gray(`  → Staking (40%):    ${(amount * 0.4).toFixed(6)} SOL`));
      console.log(chalk.gray(`  → Operations (20%): ${(amount * 0.2).toFixed(6)} SOL`));
      
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();