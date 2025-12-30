import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import fs from 'fs';
import path from 'path';

const MIN_CLAIM_THRESHOLD = 0.01 * LAMPORTS_PER_SOL;

class FeeClaimerService {
  private connection: Connection;
  private pumpSdk: OnlinePumpSdk;
  private adminKeypair: Keypair;
  private program: Program;
  private intervalId: NodeJS.Timer | null = null;

  constructor(
    connection: Connection,
    adminKeypair: Keypair,
    program: Program
  ) {
    this.connection = connection;
    this.adminKeypair = adminKeypair;
    this.program = program;
    this.pumpSdk = new OnlinePumpSdk(connection);
  }

  /**
   * Start automatic claiming every hour
   */
  startAutoClaim(intervalMs: number = 60 * 60 * 1000): void {
    console.log('Starting auto fee claimer...');
    
    // Run immediately
    this.claimAndDistribute().catch(console.error);
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      this.claimAndDistribute().catch(console.error);
    }, intervalMs);
  }

  stopAutoClaim(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
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
    try {
      const balance = await this.getCreatorFeeBalance();
      
      if (balance < MIN_CLAIM_THRESHOLD) {
        console.log(`Fee balance ${balance / LAMPORTS_PER_SOL} SOL below threshold, skipping`);
        return true;
      }

      console.log(`Claiming ${balance / LAMPORTS_PER_SOL} SOL in creator fees...`);

      // 1. Collect from PumpFun
      const collectIx = await this.pumpSdk.collectCoinCreatorFeeInstructions(
        this.adminKeypair.publicKey
      );
      
      if (!collectIx?.length) {
        console.log('No collect instructions, skipping');
        return true;
      }

      const collectTx = new Transaction().add(...collectIx);
      const collectSig = await this.connection.sendTransaction(collectTx, [this.adminKeypair]);
      await this.connection.confirmTransaction(collectSig);
      console.log(`Collected fees: ${collectSig}`);

      // Wait for balance update
      await new Promise(r => setTimeout(r, 2000));

      // 2. Transfer to FeeReceiver
      const [feeReceiverPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_receiver')],
        this.program.programId
      );

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
        console.log(`Transferred to FeeReceiver: ${transferSig}`);
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

      console.log(`Distributed fees: ${distributeSig}`);
      return true;

    } catch (error: any) {
      console.error('Fee claim error:', error.message);
      return false;
    }
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
  async manualClaim(): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await this.claimAndDistribute();
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export { FeeClaimerService };

// Example usage in your server startup:
/*
import { feeClaimerService } from './fee-claimer.service.js';

// Start auto-claiming every hour
feeClaimerService.startAutoClaim(60 * 60 * 1000);

// Or use manually via API endpoint
app.post('/admin/claim-fees', async (req, res) => {
  const result = await feeClaimerService.manualClaim();
  res.json(result);
});

app.get('/admin/fee-balances', async (req, res) => {
  const balances = await feeClaimerService.getBalances();
  res.json(balances);
});
*/