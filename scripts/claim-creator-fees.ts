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

// Minimum balance to trigger claim (in SOL)
const MIN_CLAIM_THRESHOLD = 0.01;
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
  private operationsWallet: PublicKey;

  constructor(network: string = 'devnet') {
    this.network = network;
    const networkConfig = getNetworkConfig(network as any);
    
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');
    this.pumpSdk = new PumpSDK.OnlinePumpSdk(this.connection);
    
    // Load admin keypair
    const adminPath = path.join(__dirname, '../keys/admin.json');
    if (!fs.existsSync(adminPath)) {
      throw new Error(`Admin keypair not found: ${adminPath}`);
    }
    this.adminKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(adminPath, 'utf8')))
    );
    
    // Derive PDAs
    const programId = new PublicKey(PROGRAM_ID);
    
    [this.feeReceiverPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_receiver')],
      programId
    );
    
    [this.treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('treasury')],
      programId
    );
    
    [this.rewardVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault')],
      programId
    );
    
    // Load program
    const idlPath = path.join(__dirname, '../target/idl/memecoin_lending.json');
    if (!fs.existsSync(idlPath)) {
      throw new Error(`IDL not found: ${idlPath}`);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    
    const wallet = new Wallet(this.adminKeypair);
    const provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
    this.program = new Program(idl, provider);
  }

  async initialize(): Promise<void> {
    // Fetch operations wallet from protocol state
    const [protocolStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol_state')],
      this.program.programId
    );
    
    const protocolState = await (this.program.account as any).protocolState.fetch(protocolStatePda);
    this.operationsWallet = protocolState.operationsWallet;
    
    console.log(chalk.blue('\n📍 Configuration:'));
    console.log(chalk.gray(`  Admin:           ${this.adminKeypair.publicKey.toString()}`));
    console.log(chalk.gray(`  Fee Receiver:    ${this.feeReceiverPda.toString()}`));
    console.log(chalk.gray(`  Treasury:        ${this.treasuryPda.toString()}`));
    console.log(chalk.gray(`  Reward Vault:    ${this.rewardVaultPda.toString()}`));
    console.log(chalk.gray(`  Operations:      ${this.operationsWallet.toString()}`));
  }

  /**
   * Check creator fee balance across both PumpFun programs
   */
  async getCreatorFeeBalance(): Promise<number> {
    try {
      const balance = await this.pumpSdk.getCreatorVaultBalanceBothPrograms(
        this.adminKeypair.publicKey
      );
      return balance.toNumber() / LAMPORTS_PER_SOL;
    } catch (error: any) {
      console.log(chalk.yellow(`Could not get fee balance: ${error.message}`));
      return 0;
    }
  }

  /**
   * Collect creator fees from PumpFun to admin wallet
   */
  async collectCreatorFees(): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const instructions = await this.pumpSdk.collectCoinCreatorFeeInstructions(
        this.adminKeypair.publicKey
      );
      
      if (!instructions?.length) {
        return { success: false, error: 'No fee collection instructions generated' };
      }
      
      const tx = new Transaction();
      instructions.forEach(ix => tx.add(ix));
      
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = this.adminKeypair.publicKey;
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.adminKeypair],
        { commitment: 'confirmed' }
      );
      
      return { success: true, signature };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Transfer SOL from admin wallet to FeeReceiver PDA
   */
  async transferToFeeReceiver(amount: number): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.adminKeypair.publicKey,
          toPubkey: this.feeReceiverPda,
          lamports,
        })
      );
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.adminKeypair],
        { commitment: 'confirmed' }
      );
      
      return { success: true, signature };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Call distribute_creator_fees instruction
   */
  async distributeCreatorFees(): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const signature = await this.program.methods
        .distributeCreatorFees()
        .accounts({
          feeReceiver: this.feeReceiverPda,
          treasuryWallet: this.treasuryPda,
          operationsWallet: this.operationsWallet,
          stakingRewardVault: this.rewardVaultPda,
          caller: this.adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      return { success: true, signature };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Main claim and distribute flow
   */
  async claimAndDistribute(): Promise<ClaimResult> {
    console.log(chalk.blue.bold('\n💰 CREATOR FEE CLAIM & DISTRIBUTION\n'));
    console.log(chalk.gray('─'.repeat(50)));
    
    try {
      await this.initialize();
      
      // Step 1: Check fee balance
      console.log(chalk.yellow('\n📊 Step 1: Checking creator fee balance...'));
      const feeBalance = await this.getCreatorFeeBalance();
      console.log(chalk.white(`  Total balance: ${feeBalance.toFixed(6)} SOL`));
      
      if (feeBalance < MIN_CLAIM_THRESHOLD) {
        console.log(chalk.yellow(`\n⚠️  Balance below threshold (${MIN_CLAIM_THRESHOLD} SOL), skipping`));
        return { success: true, claimed: 0 };
      }
      
      // Step 2: Record wallet balance before
      const balanceBefore = await this.connection.getBalance(this.adminKeypair.publicKey);
      console.log(chalk.gray(`  Wallet balance before: ${(balanceBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      
      // Step 3: Collect fees
      console.log(chalk.yellow('\n📥 Step 2: Collecting creator fees...'));
      const collectResult = await this.collectCreatorFees();
      
      if (!collectResult.success) {
        throw new Error(`Fee collection failed: ${collectResult.error}`);
      }
      console.log(chalk.green(`  ✓ Fees collected: ${collectResult.signature}`));
      
      // Wait for balance to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 4: Calculate amount received
      const balanceAfter = await this.connection.getBalance(this.adminKeypair.publicKey);
      const received = balanceAfter - balanceBefore;
      const amountToTransfer = received - RESERVE_FOR_FEES;
      
      console.log(chalk.gray(`  Wallet balance after: ${(balanceAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      console.log(chalk.white(`  Received: ${(received / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      
      if (amountToTransfer <= 0) {
        console.log(chalk.yellow('\n⚠️  No SOL to transfer after fees'));
        return { 
          success: true, 
          claimed: received / LAMPORTS_PER_SOL,
          collectSignature: collectResult.signature 
        };
      }
      
      // Step 5: Transfer to FeeReceiver PDA
      console.log(chalk.yellow('\n📤 Step 3: Transferring to FeeReceiver...'));
      console.log(chalk.gray(`  Amount: ${(amountToTransfer / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      
      const transferResult = await this.transferToFeeReceiver(amountToTransfer / LAMPORTS_PER_SOL);
      
      if (!transferResult.success) {
        throw new Error(`Transfer failed: ${transferResult.error}`);
      }
      console.log(chalk.green(`  ✓ Transferred: ${transferResult.signature}`));
      
      // Step 6: Distribute fees (40/40/20)
      console.log(chalk.yellow('\n📊 Step 4: Distributing fees (40/40/20)...'));
      const distributeResult = await this.distributeCreatorFees();
      
      if (!distributeResult.success) {
        throw new Error(`Distribution failed: ${distributeResult.error}`);
      }
      console.log(chalk.green(`  ✓ Distributed: ${distributeResult.signature}`));
      
      // Summary
      const distributedAmount = amountToTransfer / LAMPORTS_PER_SOL;
      console.log(chalk.green.bold('\n✅ CLAIM & DISTRIBUTION COMPLETE'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.white(`  Claimed:     ${(received / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
      console.log(chalk.white(`  Distributed: ${distributedAmount.toFixed(6)} SOL`));
      console.log(chalk.gray(`    → Treasury (40%):   ${(distributedAmount * 0.4).toFixed(6)} SOL`));
      console.log(chalk.gray(`    → Staking (40%):    ${(distributedAmount * 0.4).toFixed(6)} SOL`));
      console.log(chalk.gray(`    → Operations (20%): ${(distributedAmount * 0.2).toFixed(6)} SOL`));
      
      return {
        success: true,
        claimed: received / LAMPORTS_PER_SOL,
        distributed: distributedAmount,
        collectSignature: collectResult.signature,
        transferSignature: transferResult.signature,
        distributeSignature: distributeResult.signature,
      };
      
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * Check current balances without claiming
   */
  async checkBalances(): Promise<void> {
    console.log(chalk.blue.bold('\n📊 BALANCE CHECK\n'));
    
    await this.initialize();
    
    // Creator fee balance
    const feeBalance = await this.getCreatorFeeBalance();
    console.log(chalk.white(`\nCreator fee balance: ${feeBalance.toFixed(6)} SOL`));
    
    // Admin wallet balance
    const adminBalance = await this.connection.getBalance(this.adminKeypair.publicKey);
    console.log(chalk.white(`Admin wallet balance: ${(adminBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    
    // FeeReceiver PDA balance
    const feeReceiverBalance = await this.connection.getBalance(this.feeReceiverPda);
    console.log(chalk.white(`FeeReceiver PDA balance: ${(feeReceiverBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    
    // Treasury balance
    const treasuryBalance = await this.connection.getBalance(this.treasuryPda);
    console.log(chalk.white(`Treasury balance: ${(treasuryBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
    
    // Reward vault balance
    const rewardBalance = await this.connection.getBalance(this.rewardVaultPda);
    console.log(chalk.white(`Staking reward vault: ${(rewardBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`));
  }
}

// CLI
import { Command } from 'commander';

const program = new Command();

program
  .name('claim-creator-fees')
  .description('Claim PumpFun creator fees and distribute through protocol')
  .option('-n, --network <network>', 'Network (devnet/mainnet-beta)', 'devnet')
  .option('--check', 'Only check balances, do not claim')
  .option('--silent', 'Minimal output (for cron jobs)')
  .action(async (options) => {
    try {
      const claimer = new CreatorFeeClaimer(options.network);
      
      if (options.check) {
        await claimer.checkBalances();
      } else {
        const result = await claimer.claimAndDistribute();
        
        if (options.silent) {
          if (result.success) {
            console.log(`OK: claimed=${result.claimed?.toFixed(4) || 0} distributed=${result.distributed?.toFixed(4) || 0}`);
          } else {
            console.log(`ERROR: ${result.error}`);
          }
        }
        
        process.exit(result.success ? 0 : 1);
      }
    } catch (error: any) {
      console.error(chalk.red(`Fatal error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();