import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
// @ts-ignore
import PumpSDK from '@pump-fun/pump-sdk';
import { getFeeReceiverPDA, getTreasuryPDA, getRewardVaultPDA, getProtocolStatePDA, getDeploymentProgramId } from '@memecoin-lending/config';

const MIN_CLAIM_THRESHOLD = 0.01 * LAMPORTS_PER_SOL;

interface ClaimResult {
  success: boolean;
  claimed: number;
  distributed: number;
  breakdown?: {
    treasury: number;
    staking: number;
    operations: number;
  };
  signatures?: {
    collect?: string;
    transfer?: string;
    distribute?: string;
  };
  error?: string;
}

interface ServiceStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  lastClaimAttempt?: Date;
  lastClaimSuccess: boolean;
  totalClaimsToday: number;
  totalDistributedToday: number;
  consecutiveFailures: number;
}

class FeeClaimerService {
  private connection: Connection;
  private pumpSdk: any;
  private adminKeypair: Keypair;
  private program: Program;
  private intervalId: NodeJS.Timeout | null = null;
  private minClaimThreshold: number;
  private intervalMs: number;
  
  // Status tracking
  private status: ServiceStatus = {
    enabled: false,
    running: false,
    intervalMs: 5 * 60 * 1000, // 5 minutes
    lastClaimSuccess: false,
    totalClaimsToday: 0,
    totalDistributedToday: 0,
    consecutiveFailures: 0,
  };
  private dailyResetTime: Date = new Date();

  constructor(
    connection: Connection,
    adminKeypair: Keypair,
    program: Program,
    options?: {
      minClaimThreshold?: number;
      intervalMs?: number;
      enabled?: boolean;
    }
  ) {
    this.connection = connection;
    this.adminKeypair = adminKeypair;
    this.program = program;
    this.pumpSdk = new PumpSDK.OnlinePumpSdk(connection);
    
    this.minClaimThreshold = options?.minClaimThreshold || MIN_CLAIM_THRESHOLD;
    this.intervalMs = options?.intervalMs || 5 * 60 * 1000; // Default 5 minutes
    this.status.enabled = options?.enabled !== false;
    this.status.intervalMs = this.intervalMs;
  }

  /**
   * Start automatic claiming
   */
  startAutoClaim(intervalMs?: number): void {
    if (!this.status.enabled) {
      console.log('⚠️ Fee claimer is disabled');
      return;
    }
    
    if (this.intervalId) {
      console.log('⚠️ Auto fee claimer already running');
      return;
    }
    
    const interval = intervalMs || this.intervalMs;
    this.status.intervalMs = interval;
    this.status.running = true;
    
    console.log(`🚀 Starting auto fee claimer (interval: ${interval / 1000 / 60} minutes)`);
    
    // Run immediately
    this.performClaim().catch(error => {
      console.error('Initial fee claim failed:', error);
    });
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.performClaim().catch(error => {
        console.error('Scheduled fee claim failed:', error);
      });
    }, interval);
  }

  stopAutoClaim(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.status.running = false;
      console.log('🛑 Auto fee claimer stopped');
    }
  }
  
  private resetDailyStats(): void {
    const now = new Date();
    if (now.getDate() !== this.dailyResetTime.getDate()) {
      this.status.totalClaimsToday = 0;
      this.status.totalDistributedToday = 0;
      this.dailyResetTime = now;
    }
  }
  
  private async performClaim(): Promise<ClaimResult> {
    this.resetDailyStats();
    this.status.lastClaimAttempt = new Date();
    
    const result = await this.claimAndDistributeWithResult();
    
    if (result.success) {
      this.status.lastClaimSuccess = true;
      this.status.consecutiveFailures = 0;
      this.status.totalClaimsToday++;
      this.status.totalDistributedToday += result.distributed;
    } else {
      this.status.lastClaimSuccess = false;
      this.status.consecutiveFailures++;
      
      // Alert if too many consecutive failures
      if (this.status.consecutiveFailures >= 5) {
        console.error(`🚨 ALERT: Fee claimer has failed ${this.status.consecutiveFailures} consecutive times`);
      }
    }
    
    return result;
  }

  async getCreatorFeeBalance(): Promise<number> {
    try {
      const balance = await this.pumpSdk.getCreatorVaultBalanceBothPrograms(
        this.adminKeypair.publicKey
      );
      return balance.toNumber();
    } catch {
      return 0;
    }
  }

  async claimAndDistribute(): Promise<boolean> {
    const result = await this.claimAndDistributeWithResult();
    return result.success;
  }
  
  async claimAndDistributeWithResult(): Promise<ClaimResult> {
    const result: ClaimResult = {
      success: false,
      claimed: 0,
      distributed: 0,
      signatures: {},
    };
    
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        const balance = await this.getCreatorFeeBalance();
        result.claimed = balance / LAMPORTS_PER_SOL;
        
        if (balance < this.minClaimThreshold) {
          console.log(`Fee balance ${result.claimed} SOL below threshold ${this.minClaimThreshold / LAMPORTS_PER_SOL} SOL, skipping`);
          result.success = true;
          return result;
        }

        console.log(`📍 Attempting to claim ${result.claimed} SOL in creator fees...`);

        // 1. Collect from PumpFun
        const collectIx = await this.pumpSdk.collectCoinCreatorFeeInstructions(
          this.adminKeypair.publicKey
        );
        
        if (!collectIx?.length) {
          console.log('No collect instructions, skipping');
          result.success = true;
          return result;
        }

        const collectTx = new Transaction().add(...collectIx);
        const collectSig = await this.connection.sendTransaction(collectTx, [this.adminKeypair]);
        await this.connection.confirmTransaction(collectSig);
        if (result.signatures) result.signatures.collect = collectSig;
        console.log(`✅ Collected fees: ${collectSig}`);

        // Wait for balance update
        await new Promise(r => setTimeout(r, 2000));

        // 2. Transfer to FeeReceiver
        const [feeReceiverPda] = getFeeReceiverPDA();
        if (!feeReceiverPda) throw new Error('Fee receiver PDA not found');

        const walletBalance = await this.connection.getBalance(this.adminKeypair.publicKey);
        const transferAmount = walletBalance - 0.01 * LAMPORTS_PER_SOL; // Keep some for fees

        if (transferAmount > 0) {
          const transferTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: this.adminKeypair.publicKey,
              toPubkey: feeReceiverPda,
              lamports: transferAmount,
            })
          );
          const transferSig = await this.connection.sendTransaction(transferTx, [this.adminKeypair]);
          await this.connection.confirmTransaction(transferSig);
          if (result.signatures) result.signatures.transfer = transferSig;
          result.distributed = transferAmount / LAMPORTS_PER_SOL;
          console.log(`✅ Transferred ${result.distributed} SOL to FeeReceiver: ${transferSig}`);
        }

        // 3. Distribute 40/40/20
        const [treasuryPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('treasury')],
          this.program.programId
        );
        const [rewardVaultPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('reward_vault')],
          this.program.programId
        );
        const [protocolStatePda] = PublicKey.findProgramAddressSync(
          [Buffer.from('protocol_state')],
          this.program.programId
        );

        const protocolState = await (this.program.account as any).protocolState.fetch(protocolStatePda);

        const distributeSig = await this.program.methods
          .distributeCreatorFees()
          .accounts({
            feeReceiver: feeReceiverPda,
            treasuryWallet: treasuryPda,
            operationsWallet: protocolState.operationsWallet,
            stakingRewardVault: rewardVaultPda,
            caller: this.adminKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        if (result.signatures) result.signatures.distribute = distributeSig;
        console.log(`✅ Distributed fees: ${distributeSig}`);
        
        // Calculate breakdown (40/40/20)
        result.breakdown = {
          treasury: result.distributed * 0.4,
          staking: result.distributed * 0.4,
          operations: result.distributed * 0.2,
        };
        
        result.success = true;
        console.log(`💰 Successfully claimed and distributed ${result.distributed} SOL`);
        return result;

      } catch (error: any) {
        retries++;
        console.error(`Fee claim attempt ${retries}/${maxRetries} failed:`, error.message);
        
        if (retries < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, retries) * 1000;
          console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          result.error = error.message;
        }
      }
    }
    
    return result;
  }

  /**
   * Get current fee balances across all PDAs
   */
  async getBalances(): Promise<{
    creatorFees: number;
    adminWallet: number;
    feeReceiver: number;
    treasury: number;
    rewardVault: number;
  }> {
    const [feeReceiverPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_receiver')],
      this.program.programId
    );
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('treasury')],
      this.program.programId
    );
    const [rewardVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault')],
      this.program.programId
    );

    const [
      creatorFees,
      adminWallet,
      feeReceiver,
      treasury,
      rewardVault
    ] = await Promise.all([
      this.getCreatorFeeBalance(),
      this.connection.getBalance(this.adminKeypair.publicKey),
      this.connection.getBalance(feeReceiverPda),
      this.connection.getBalance(treasuryPda),
      this.connection.getBalance(rewardVaultPda)
    ]);

    return {
      creatorFees: creatorFees / LAMPORTS_PER_SOL,
      adminWallet: adminWallet / LAMPORTS_PER_SOL,
      feeReceiver: feeReceiver / LAMPORTS_PER_SOL,
      treasury: treasury / LAMPORTS_PER_SOL,
      rewardVault: rewardVault / LAMPORTS_PER_SOL,
    };
  }

  /**
   * Manually trigger a claim and distribution
   */
  async manualClaim(): Promise<ClaimResult> {
    console.log('📍 Manual fee claim triggered');
    return await this.performClaim();
  }
  
  /**
   * Get service status
   */
  getStatus(): ServiceStatus & { timestamp: string } {
    this.resetDailyStats();
    return {
      ...this.status,
      timestamp: new Date().toISOString(),
    };
  }
}

export { FeeClaimerService };
export type { ClaimResult, ServiceStatus };