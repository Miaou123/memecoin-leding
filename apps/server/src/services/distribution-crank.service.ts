import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, AccountMeta, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN, Idl } from '@coral-xyz/anchor';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import * as fs from 'fs';
import * as path from 'path';

// Constants
const BATCH_SIZE = 10; // 10 users per transaction (20 accounts total)
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// PDA Seeds (must match your program)
const STAKING_POOL_SEED = Buffer.from('staking_pool');
const REWARD_VAULT_SEED = Buffer.from('reward_vault');
const USER_STAKE_SEED = Buffer.from('user_stake');

interface UserStakeAccount {
  pubkey: PublicKey;
  owner: PublicKey;
  stakedAmount: bigint;
  stakeStartEpoch: number;
  lastRewardedEpoch: number;
}

interface StakingPoolState {
  currentEpoch: number;
  epochDuration: number;
  epochStartTime: number;
  totalStaked: bigint;
  currentEpochEligibleStake: bigint;
  currentEpochRewards: bigint;
  lastEpochRewards: bigint;
  lastEpochEligibleStake: bigint;
  lastEpochDistributed: bigint;
  paused: boolean;
}

interface DistributionResult {
  success: boolean;
  epochAdvanced: boolean;
  usersDistributed: number;
  totalDistributed: bigint;
  batches: number;
  errors: string[];
}

class DistributionCrankService {
  private connection: Connection;
  private program: Program | null = null;
  private wallet: Keypair | null = null;
  private stakingPoolPDA: PublicKey | null = null;
  private rewardVaultPDA: PublicKey | null = null;
  private initialized = false;
  
  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || getNetworkConfig('devnet').rpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }
  
  /**
   * Initialize the crank service with wallet and program
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Load admin wallet
      const walletPath = process.env.ADMIN_WALLET_PATH || './keys/admin.json';
      
      if (!fs.existsSync(walletPath)) {
        console.warn('⚠️ Admin keypair not found at', walletPath);
        console.warn('⚠️ Distribution crank will not function without admin keypair');
        return;
      }
      
      const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
      this.wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
      
      console.log(`🔑 Distribution crank wallet: ${this.wallet.publicKey.toString()}`);
      
      // Check wallet balance
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      console.log(`💰 Crank wallet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      
      if (balance < 0.01 * LAMPORTS_PER_SOL) {
        console.warn('⚠️ Crank wallet has low balance. Distribution transactions may fail.');
      }
      
      // Initialize Anchor program
      const provider = new AnchorProvider(
        this.connection,
        new Wallet(this.wallet),
        { commitment: 'confirmed' }
      );
      
      // Load IDL with better path resolution
      const idlPaths = [
        process.env.IDL_PATH,
        path.join(process.cwd(), 'target/idl/memecoin_lending.json'),
        path.join(process.cwd(), '../../target/idl/memecoin_lending.json'),
        path.join(process.cwd(), '../..', 'target/idl/memecoin_lending.json'),
        path.join(__dirname, '../../../target/idl/memecoin_lending.json'),
      ].filter(Boolean);
      
      let idl;
      for (const p of idlPaths) {
        if (p && fs.existsSync(p)) {
          idl = JSON.parse(fs.readFileSync(p, 'utf-8'));
          break;
        }
      }
      
      if (!idl) {
        console.warn('⚠️ IDL file not found. Distribution crank will not function.');
        return;
      }
      
      // Create program with proper IDL type
      this.program = new Program(idl as Idl, provider);
      
      // Derive PDAs
      [this.stakingPoolPDA] = PublicKey.findProgramAddressSync(
        [STAKING_POOL_SEED],
        new PublicKey(PROGRAM_ID)
      );
      
      [this.rewardVaultPDA] = PublicKey.findProgramAddressSync(
        [REWARD_VAULT_SEED],
        new PublicKey(PROGRAM_ID)
      );
      
      console.log(`📍 Staking Pool PDA: ${this.stakingPoolPDA.toString()}`);
      console.log(`📍 Reward Vault PDA: ${this.rewardVaultPDA.toString()}`);
      
      this.initialized = true;
      console.log('✅ Distribution crank service initialized');
      
    } catch (error: any) {
      console.error('❌ Failed to initialize distribution crank:', error.message);
    }
  }
  
  /**
   * Main tick function - called periodically by the job
   */
  async tick(): Promise<DistributionResult> {
    const result: DistributionResult = {
      success: false,
      epochAdvanced: false,
      usersDistributed: 0,
      totalDistributed: BigInt(0),
      batches: 0,
      errors: [],
    };
    
    if (!this.initialized || !this.program || !this.wallet) {
      result.errors.push('Service not initialized');
      return result;
    }
    
    try {
      // 1. Get current staking pool state
      const poolState = await this.getStakingPoolState();
      
      if (!poolState) {
        result.errors.push('Failed to fetch staking pool state');
        return result;
      }
      
      if (poolState.paused) {
        console.log('⏸️ Staking is paused. Skipping distribution.');
        result.success = true;
        return result;
      }
      
      const now = Math.floor(Date.now() / 1000);
      const epochEndTime = poolState.epochStartTime + poolState.epochDuration;
      
      // 2. Check if epoch has ended
      if (now < epochEndTime) {
        const remaining = epochEndTime - now;
        console.log(`⏳ Epoch ${poolState.currentEpoch} ends in ${remaining}s`);
        result.success = true;
        return result;
      }
      
      console.log(`📊 Epoch ${poolState.currentEpoch} ended. Processing...`);
      
      // 3. Check if last epoch was distributed
      const pendingDistribution = poolState.lastEpochRewards - poolState.lastEpochDistributed;
      
      if (pendingDistribution > BigInt(0) && poolState.lastEpochEligibleStake > BigInt(0)) {
        // Still have pending distribution from last epoch
        console.log(`💰 Continuing distribution: ${pendingDistribution} lamports remaining`);
        await this.distributeRewards(poolState.currentEpoch - 1, result);
      } else {
        // 4. Advance epoch first
        console.log('🔄 Advancing epoch...');
        const advanceSuccess = await this.advanceEpoch();
        
        if (advanceSuccess) {
          result.epochAdvanced = true;
          console.log(`✅ Advanced to epoch ${poolState.currentEpoch + 1}`);
          
          // 5. Distribute rewards for the completed epoch
          await this.distributeRewards(poolState.currentEpoch, result);
        } else {
          result.errors.push('Failed to advance epoch');
        }
      }
      
      result.success = result.errors.length === 0;
      
    } catch (error: any) {
      console.error('❌ Distribution tick error:', error.message);
      result.errors.push(error.message);
    }
    
    return result;
  }
  
  /**
   * Get staking pool state
   */
  async getStakingPoolState(): Promise<StakingPoolState | null> {
    if (!this.stakingPoolPDA) return null;
    
    try {
      const accountInfo = await this.connection.getAccountInfo(this.stakingPoolPDA);
      
      if (!accountInfo || !accountInfo.data) {
        console.log('🔍 Staking pool account not found');
        return null;
      }
      
      // Parse staking pool data
      // Layout after direct distribution changes:
      // disc(8) + authority(32) + mint(32) + stakingVault(32) + rewardVault(32) = 136
      // + currentEpoch(8) + epochDuration(8) + epochStartTime(8) = 160
      // + totalStaked(8) + currentEpochEligibleStake(8) + currentEpochRewards(8) = 184
      // + lastEpochRewards(8) + lastEpochEligibleStake(8) + lastEpochDistributed(8) = 208
      // + totalRewardsDistributed(8) + totalRewardsDeposited(8) + totalEpochsCompleted(8) = 232
      // + paused(1) + bump(1) + reserved(64) = 298
      
      const data = accountInfo.data;
      let offset = 8; // Skip discriminator
      
      // Skip authority, mint, stakingVault, rewardVault (32 * 4 = 128)
      offset += 128;
      
      const currentEpoch = Number(data.readBigUInt64LE(offset)); offset += 8;
      const epochDuration = Number(data.readBigInt64LE(offset)); offset += 8;
      const epochStartTime = Number(data.readBigInt64LE(offset)); offset += 8;
      const totalStaked = data.readBigUInt64LE(offset); offset += 8;
      const currentEpochEligibleStake = data.readBigUInt64LE(offset); offset += 8;
      const currentEpochRewards = data.readBigUInt64LE(offset); offset += 8;
      const lastEpochRewards = data.readBigUInt64LE(offset); offset += 8;
      const lastEpochEligibleStake = data.readBigUInt64LE(offset); offset += 8;
      const lastEpochDistributed = data.readBigUInt64LE(offset); offset += 8;
      
      // Skip totalRewardsDistributed, totalRewardsDeposited, totalEpochsCompleted
      offset += 24;
      
      const paused = data[offset] === 1;
      
      return {
        currentEpoch,
        epochDuration,
        epochStartTime,
        totalStaked,
        currentEpochEligibleStake,
        currentEpochRewards,
        lastEpochRewards,
        lastEpochEligibleStake,
        lastEpochDistributed,
        paused,
      };
      
    } catch (error: any) {
      console.error('❌ Failed to fetch staking pool:', error.message);
      return null;
    }
  }
  
  /**
   * Advance to next epoch
   */
  async advanceEpoch(): Promise<boolean> {
    if (!this.program || !this.stakingPoolPDA || !this.wallet) return false;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const tx = await this.program.methods
          .advanceEpoch()
          .accounts({
            stakingPool: this.stakingPoolPDA,
            caller: this.wallet.publicKey,
          })
          .rpc();
        
        console.log(`✅ Epoch advanced. TX: ${tx}`);
        return true;
        
      } catch (error: any) {
        if (error.message?.includes('EpochNotEnded')) {
          console.log('⏳ Epoch not ready to advance yet');
          return false;
        }
        
        if (error.message?.includes('DistributionNotComplete')) {
          console.log('⚠️ Previous distribution not complete. Continue distributing first.');
          return false;
        }
        
        console.error(`❌ Advance epoch attempt ${attempt} failed:`, error.message);
        
        if (attempt < MAX_RETRIES) {
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }
    
    return false;
  }
  
  /**
   * Distribute rewards to all eligible stakers
   */
  async distributeRewards(forEpoch: number, result: DistributionResult): Promise<void> {
    if (!this.program || !this.stakingPoolPDA || !this.rewardVaultPDA || !this.wallet) {
      result.errors.push('Service not properly initialized');
      return;
    }
    
    try {
      // Get all eligible stakers
      const stakers = await this.getEligibleStakers(forEpoch);
      
      if (stakers.length === 0) {
        console.log('👥 No eligible stakers for epoch', forEpoch);
        return;
      }
      
      console.log(`👥 Found ${stakers.length} eligible stakers for epoch ${forEpoch}`);
      
      // Batch and distribute
      const batches = this.chunk(stakers, BATCH_SIZE);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`📦 Processing batch ${i + 1}/${batches.length} (${batch.length} users)...`);
        
        const batchResult = await this.distributeBatch(batch);
        
        if (batchResult.success) {
          result.usersDistributed += batchResult.usersDistributed;
          result.totalDistributed += batchResult.amountDistributed;
          result.batches++;
          console.log(`✅ Batch ${i + 1} complete: ${batchResult.usersDistributed} users, ${batchResult.amountDistributed} lamports`);
        } else {
          result.errors.push(`Batch ${i + 1} failed: ${batchResult.error}`);
          console.error(`❌ Batch ${i + 1} failed:`, batchResult.error);
        }
        
        // Small delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await this.sleep(500);
        }
      }
      
      console.log(`✅ Distribution complete: ${result.usersDistributed} users, ${result.totalDistributed} lamports total`);
      
    } catch (error: any) {
      console.error('❌ Distribution error:', error.message);
      result.errors.push(error.message);
    }
  }
  
  /**
   * Get all stakers eligible for a specific epoch
   */
  async getEligibleStakers(forEpoch: number): Promise<UserStakeAccount[]> {
    if (!this.stakingPoolPDA) return [];
    
    try {
      // Get all UserStake accounts for this program
      const accounts = await this.connection.getProgramAccounts(
        new PublicKey(PROGRAM_ID),
        {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: 'J6ZWGMgjwQC', // UserStake discriminator [102,53,163,107,9,138,87,153] in base58
              },
            },
            {
              memcmp: {
                offset: 40, // Skip discriminator (8) + owner (32) = position of pool pubkey
                bytes: this.stakingPoolPDA.toBase58(),
              },
            },
          ],
        }
      );
      
      const eligible: UserStakeAccount[] = [];
      
      for (const { pubkey, account } of accounts) {
        const data = account.data;
        let offset = 8; // Skip discriminator
        
        // Read owner
        const ownerBytes = data.slice(offset, offset + 32);
        const owner = new PublicKey(ownerBytes);
        offset += 32;
        
        // Read pool
        const poolBytes = data.slice(offset, offset + 32);
        const pool = new PublicKey(poolBytes);
        offset += 32;
        
        // Check if this is for our staking pool
        if (!pool.equals(this.stakingPoolPDA)) continue;
        
        // Read staked amount
        const stakedAmount = data.readBigUInt64LE(offset);
        offset += 8;
        
        // Read stake start epoch
        const stakeStartEpoch = Number(data.readBigUInt64LE(offset));
        offset += 8;
        
        // Read last rewarded epoch
        const lastRewardedEpoch = Number(data.readBigUInt64LE(offset));
        
        // Check eligibility:
        // 1. Has stake
        // 2. Was staked before the epoch we're distributing for
        // 3. Hasn't been rewarded for this epoch yet
        if (
          stakedAmount > BigInt(0) &&
          stakeStartEpoch < forEpoch &&
          lastRewardedEpoch < forEpoch
        ) {
          eligible.push({
            pubkey,
            owner,
            stakedAmount,
            stakeStartEpoch,
            lastRewardedEpoch,
          });
        }
      }
      
      return eligible;
      
    } catch (error: any) {
      console.error('❌ Failed to get eligible stakers:', error.message);
      return [];
    }
  }
  
  /**
   * Distribute to a batch of users
   */
  async distributeBatch(
    stakers: UserStakeAccount[]
  ): Promise<{ success: boolean; usersDistributed: number; amountDistributed: bigint; error?: string }> {
    if (!this.program || !this.stakingPoolPDA || !this.rewardVaultPDA || !this.wallet) {
      return { success: false, usersDistributed: 0, amountDistributed: BigInt(0), error: 'Not initialized' };
    }
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Build remaining accounts array
        const remainingAccounts: AccountMeta[] = stakers.flatMap(s => [
          { pubkey: s.pubkey, isSigner: false, isWritable: true },
          { pubkey: s.owner, isSigner: false, isWritable: true },
        ]);
        
        const tx = await this.program.methods
          .distributeRewards()
          .accounts({
            stakingPool: this.stakingPoolPDA,
            rewardVault: this.rewardVaultPDA,
            caller: this.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .rpc();
        
        console.log(`📤 Distribution TX: ${tx}`);
        
        // TODO: Parse transaction logs to get actual distributed amount
        // For now, estimate based on stakers
        return {
          success: true,
          usersDistributed: stakers.length,
          amountDistributed: BigInt(0), // Would parse from logs
        };
        
      } catch (error: any) {
        console.error(`❌ Batch distribution attempt ${attempt} failed:`, error.message);
        
        if (attempt < MAX_RETRIES) {
          await this.sleep(RETRY_DELAY_MS);
        } else {
          return {
            success: false,
            usersDistributed: 0,
            amountDistributed: BigInt(0),
            error: error.message,
          };
        }
      }
    }
    
    return { success: false, usersDistributed: 0, amountDistributed: BigInt(0), error: 'Max retries exceeded' };
  }
  
  /**
   * Get service status
   */
  async getStatus(): Promise<{
    initialized: boolean;
    walletAddress: string | null;
    walletBalance: number;
    stakingPoolPDA: string | null;
    currentEpoch: number | null;
    epochEndsIn: number | null;
    lastEpochRewards: string | null;
    lastEpochDistributed: string | null;
  }> {
    let walletBalance = 0;
    let currentEpoch: number | null = null;
    let epochEndsIn: number | null = null;
    let lastEpochRewards: string | null = null;
    let lastEpochDistributed: string | null = null;
    
    if (this.wallet) {
      walletBalance = await this.connection.getBalance(this.wallet.publicKey) / LAMPORTS_PER_SOL;
    }
    
    if (this.initialized) {
      const poolState = await this.getStakingPoolState();
      if (poolState) {
        currentEpoch = poolState.currentEpoch;
        const now = Math.floor(Date.now() / 1000);
        epochEndsIn = Math.max(0, (poolState.epochStartTime + poolState.epochDuration) - now);
        lastEpochRewards = poolState.lastEpochRewards.toString();
        lastEpochDistributed = poolState.lastEpochDistributed.toString();
      }
    }
    
    return {
      initialized: this.initialized,
      walletAddress: this.wallet?.publicKey.toString() || null,
      walletBalance,
      stakingPoolPDA: this.stakingPoolPDA?.toString() || null,
      currentEpoch,
      epochEndsIn,
      lastEpochRewards,
      lastEpochDistributed,
    };
  }
  
  // Utility functions
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const distributionCrankService = new DistributionCrankService();