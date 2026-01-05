#!/usr/bin/env tsx

import { config } from 'dotenv';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
// @ts-ignore
import PumpSDK from '@pump-fun/pump-sdk';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

// Lower threshold for testing
const MIN_CLAIM_THRESHOLD = 0.001; // 0.001 SOL for testing
// Keep in wallet for transaction fees
const RESERVE_FOR_FEES = 0.005 * LAMPORTS_PER_SOL;

interface ClaimResult {
  success: boolean;
  claimed?: number;
  distributed?: number;
  collectSignature?: string;
  transferSignature?: string;
  distributeSignature?: string;
  error?: string;
}

class CreatorFeeClaimer {
  private connection: Connection;
  private adminKeypair: Keypair;
  private pumpSdk: any;
  private program: Program;
  private network: string;
  
  // PDAs (will be derived)
  private feeReceiverPda: PublicKey;
  private treasuryPda: PublicKey;
  private rewardVaultPda: PublicKey;
  private protocolStatePda: PublicKey;
  
  constructor(network: string = 'mainnet-beta') {
    this.network = network;
    const networkConfig = getNetworkConfig(network);
    
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');
    this.pumpSdk = new PumpSDK.OnlinePumpSdk(this.connection);
    
    // Load admin keypair
    const adminPath = path.join(__dirname, '../keys/admin.json');
    this.adminKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(adminPath, 'utf-8')))
    );
    
    // Initialize program
    const wallet = new Wallet(this.adminKeypair);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
    });
    
    // Load IDL
    const idlPath = path.join(__dirname, '../target/idl/memecoin_lending.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const programId = networkConfig.programs?.memecoingLending || PROGRAM_ID[network];
    
    if (!programId) {
      throw new Error(`No program ID found for network ${network}`);
    }
    
    this.program = new Program(idl, programId, provider);
    
    // Derive PDAs
    this.derivePDAs();
  }
  
  private derivePDAs(): void {
    // Fee receiver PDA
    [this.feeReceiverPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_receiver')],
      this.program.programId
    );
    
    // Treasury PDA
    [this.treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('treasury')],
      this.program.programId
    );
    
    // Reward vault PDA
    [this.rewardVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault')],
      this.program.programId
    );
    
    // Protocol state PDA
    [this.protocolStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol_state')],
      this.program.programId
    );
  }
  
  async checkBalances(): Promise<void> {
    console.log(chalk.cyan('📊 BALANCE CHECK\n'));
    
    // Get protocol state to find operations wallet
    const protocolState = await (this.program.account as any).protocolState.fetch(this.protocolStatePda);
    
    console.log(chalk.gray('\n📍 Configuration:'));
    console.log(chalk.gray(`  Admin:           ${this.adminKeypair.publicKey}`));
    console.log(chalk.gray(`  Fee Receiver:    ${this.feeReceiverPda}`));
    console.log(chalk.gray(`  Treasury:        ${this.treasuryPda}`));
    console.log(chalk.gray(`  Reward Vault:    ${this.rewardVaultPda}`));
    console.log(chalk.gray(`  Operations:      ${protocolState.operationsWallet}`));
    
    // Check creator fee balance
    const creatorBalance = await this.pumpSdk.getCreatorVaultBalanceBothPrograms(
      this.adminKeypair.publicKey
    );
    console.log(chalk.yellow(`\nCreator fee balance: ${(creatorBalance.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    
    // Check admin wallet balance
    const adminBalance = await this.connection.getBalance(this.adminKeypair.publicKey);
    console.log(chalk.yellow(`Admin wallet balance: ${(adminBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    
    // Check PDA balances
    const [feeReceiverBalance, treasuryBalance, rewardVaultBalance] = await Promise.all([
      this.connection.getBalance(this.feeReceiverPda),
      this.connection.getBalance(this.treasuryPda),
      this.connection.getBalance(this.rewardVaultPda)
    ]);
    
    console.log(chalk.yellow(`FeeReceiver PDA balance: ${(feeReceiverBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    console.log(chalk.yellow(`Treasury balance: ${(treasuryBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    console.log(chalk.yellow(`Staking reward vault: ${(rewardVaultBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
  }
  
  async claimAndDistribute(): Promise<ClaimResult> {
    console.log(chalk.bold.cyan('💰 CREATOR FEE CLAIM & DISTRIBUTION - TEST MODE\n'));
    console.log(chalk.gray('──────────────────────────────────────────────────\n'));
    
    const result: ClaimResult = {
      success: false
    };
    
    try {
      // Check configuration
      await this.checkBalances();
      
      // Get protocol state for operations wallet
      const protocolState = await (this.program.account as any).protocolState.fetch(this.protocolStatePda);
      
      // Step 1: Check creator fee balance
      console.log(chalk.cyan('\n📊 Step 1: Checking creator fee balance...'));
      const creatorBalance = await this.pumpSdk.getCreatorVaultBalanceBothPrograms(
        this.adminKeypair.publicKey
      );
      const balanceSOL = creatorBalance.toNumber() / LAMPORTS_PER_SOL;
      console.log(chalk.yellow(`  Total balance: ${balanceSOL.toFixed(6)} SOL`));
      
      if (balanceSOL < MIN_CLAIM_THRESHOLD) {
        console.log(chalk.red(`\n⚠️  Balance below test threshold (${MIN_CLAIM_THRESHOLD} SOL), but continuing for test...`));
      }
      
      // Step 2: Collect creator fees
      console.log(chalk.cyan('\n📝 Step 2: Collecting creator fees from PumpFun...'));
      const collectIx = await this.pumpSdk.collectCoinCreatorFeeInstructions(
        this.adminKeypair.publicKey
      );
      
      if (!collectIx || collectIx.length === 0) {
        console.log(chalk.yellow('  No fee collection instructions generated'));
        console.log(chalk.gray('  This usually means no fees to claim or not the token creator'));
        result.error = 'No collection instructions';
        return result;
      }
      
      const collectTx = new Transaction().add(...collectIx);
      const collectSig = await sendAndConfirmTransaction(
        this.connection,
        collectTx,
        [this.adminKeypair]
      );
      
      console.log(chalk.green(`  ✅ Collection TX: ${collectSig}`));
      result.collectSignature = collectSig;
      
      // Wait for balance update
      console.log(chalk.gray('  Waiting for balance update...'));
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Step 3: Transfer to FeeReceiver
      console.log(chalk.cyan('\n💸 Step 3: Transferring to FeeReceiver PDA...'));
      const walletBalance = await this.connection.getBalance(this.adminKeypair.publicKey);
      const transferAmount = walletBalance - RESERVE_FOR_FEES;
      
      if (transferAmount <= 0) {
        console.log(chalk.yellow('  Not enough balance to transfer'));
        result.error = 'Insufficient balance for transfer';
        return result;
      }
      
      console.log(chalk.yellow(`  Transferring: ${(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      
      const transferTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.adminKeypair.publicKey,
          toPubkey: this.feeReceiverPda,
          lamports: transferAmount,
        })
      );
      
      const transferSig = await sendAndConfirmTransaction(
        this.connection,
        transferTx,
        [this.adminKeypair]
      );
      
      console.log(chalk.green(`  ✅ Transfer TX: ${transferSig}`));
      result.transferSignature = transferSig;
      result.claimed = transferAmount / LAMPORTS_PER_SOL;
      
      // Step 4: Distribute fees (40/40/20 split)
      console.log(chalk.cyan('\n📊 Step 4: Distributing fees (40/40/20 split)...'));
      
      const distributeTx = await this.program.methods
        .distributeCreatorFees()
        .accounts({
          feeReceiver: this.feeReceiverPda,
          treasuryWallet: this.treasuryPda,
          operationsWallet: protocolState.operationsWallet,
          stakingRewardVault: this.rewardVaultPda,
          caller: this.adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log(chalk.green(`  ✅ Distribution TX: ${distributeTx}`));
      result.distributeSignature = distributeTx;
      result.distributed = transferAmount / LAMPORTS_PER_SOL;
      
      // Show distribution breakdown
      const treasury = transferAmount * 0.4 / LAMPORTS_PER_SOL;
      const staking = transferAmount * 0.4 / LAMPORTS_PER_SOL;
      const operations = transferAmount * 0.2 / LAMPORTS_PER_SOL;
      
      console.log(chalk.gray('\n  Distribution breakdown:'));
      console.log(chalk.gray(`    Treasury (40%):     ${treasury.toFixed(6)} SOL`));
      console.log(chalk.gray(`    Staking (40%):      ${staking.toFixed(6)} SOL`));
      console.log(chalk.gray(`    Operations (20%):   ${operations.toFixed(6)} SOL`));
      
      result.success = true;
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ Error:'), error.message);
      result.error = error.message;
    }
    
    return result;
  }
}

async function main() {
  const claimer = new CreatorFeeClaimer('mainnet-beta');
  
  if (process.argv.includes('--check')) {
    await claimer.checkBalances();
  } else {
    const result = await claimer.claimAndDistribute();
    
    console.log(chalk.cyan('\n📊 RESULT:'));
    console.log(chalk.gray('──────────────────────────────────────────────────'));
    console.log(chalk.yellow(`Success: ${result.success}`));
    if (result.claimed) {
      console.log(chalk.yellow(`Claimed: ${result.claimed.toFixed(6)} SOL`));
    }
    if (result.distributed) {
      console.log(chalk.yellow(`Distributed: ${result.distributed.toFixed(6)} SOL`));
    }
    if (result.error) {
      console.log(chalk.red(`Error: ${result.error}`));
    }
  }
}

main().catch(console.error);