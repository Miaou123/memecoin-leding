import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, AccountMeta, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN, Idl } from '@coral-xyz/anchor';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import * as fs from 'fs';
import * as path from 'path';

// Constants
const BATCH_SIZE = 10; // 10 users per transaction (20 accounts total)
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const USER_STAKE_DISCRIMINATOR = Buffer.from([102, 53, 163, 107, 9, 138, 87, 153]); // UserStake discriminator
const MIN_INTERVAL_BETWEEN_DISTRIBUTIONS_MS = 10000; // Minimum 10 seconds between distributions
const MAX_DISTRIBUTIONS_PER_HOUR = 100; // Maximum 100 distribution transactions per hour

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
  private lastDistributionTime = 0;
  private distributionsThisHour: { timestamp: number }[] = [];
  
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
      const walletPath = process.env.ADMIN_WALLET_PATH || '../../keys/admin.json';
      
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
      
      // SECURITY: Check pause status
      if (poolState.paused) {
        console.log('⏸️ SECURITY: Staking is paused. Skipping distribution.');
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
      
      // 3. Log vault status for debugging
      if (this.rewardVaultPDA) {
        const vaultBalance = await this.connection.getBalance(this.rewardVaultPDA);
        console.log(`💰 Reward vault balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`📊 Tracked last_epoch_rewards: ${Number(poolState.lastEpochRewards) / LAMPORTS_PER_SOL} SOL`);
        console.log(`📊 Will distribute: ${Math.min(vaultBalance, Number(poolState.lastEpochRewards)) / LAMPORTS_PER_SOL} SOL`);
      }
      
      // 4. ALWAYS advance epoch first
      console.log('🔄 Advancing epoch...');
      const advanceSuccess = await this.advanceEpoch();
      
      if (advanceSuccess) {
        result.epochAdvanced = true;
        console.log(`✅ Advanced to epoch ${poolState.currentEpoch + 1}`);
        
        // 5. Then try distribution (may fail if vault empty, that's OK)
        try {
          await this.distributeRewards(poolState.currentEpoch, result);
        } catch (e: any) {
          console.log('⚠️ Distribution failed (will retry next tick):', e.message);
          // Don't add to errors - distribution failure is acceptable
        }
      } else {
        result.errors.push('Failed to advance epoch');
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
    
    // Rate limiting: Check minimum interval
    const now = Date.now();
    const timeSinceLastDistribution = now - this.lastDistributionTime;
    
    if (timeSinceLastDistribution < MIN_INTERVAL_BETWEEN_DISTRIBUTIONS_MS) {
      console.log(`⏳ Rate limit: Must wait ${MIN_INTERVAL_BETWEEN_DISTRIBUTIONS_MS - timeSinceLastDistribution}ms before next distribution`);
      result.errors.push('Rate limit: Too soon after last distribution');
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Staking',
        eventType: SECURITY_EVENT_TYPES.DISTRIBUTION_RATE_LIMITED,
        message: 'Distribution rate limit exceeded - too soon after last distribution',
        details: {
          timeSinceLastDistribution,
          minimumInterval: MIN_INTERVAL_BETWEEN_DISTRIBUTIONS_MS,
          waitTime: MIN_INTERVAL_BETWEEN_DISTRIBUTIONS_MS - timeSinceLastDistribution,
          lastDistribution: new Date(this.lastDistributionTime).toISOString(),
        },
        source: 'distribution-crank',
      });
      return;
    }
    
    // Rate limiting: Check hourly limit
    const oneHourAgo = now - (60 * 60 * 1000);
    this.distributionsThisHour = this.distributionsThisHour.filter(d => d.timestamp > oneHourAgo);
    
    if (this.distributionsThisHour.length >= MAX_DISTRIBUTIONS_PER_HOUR) {
      console.log(`⚠️ Rate limit: Reached maximum distributions per hour (${MAX_DISTRIBUTIONS_PER_HOUR})`);
      result.errors.push('Rate limit: Maximum distributions per hour exceeded');
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Staking',
        eventType: SECURITY_EVENT_TYPES.DISTRIBUTION_RATE_LIMITED,
        message: 'Hourly distribution limit exceeded',
        details: {
          currentHourDistributions: this.distributionsThisHour.length,
          limit: MAX_DISTRIBUTIONS_PER_HOUR,
        },
        source: 'distribution-crank',
      });
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
          
          // Log batch failure as security event
          await securityMonitor.log({
            severity: 'MEDIUM',
            category: 'Staking',
            eventType: SECURITY_EVENT_TYPES.DISTRIBUTION_BATCH_FAILED,
            message: `Distribution batch ${i + 1} failed after retries`,
            details: {
              batchIndex: i + 1,
              batchSize: batches[i].length,
              error: batchResult.error,
              epoch: forEpoch,
            },
            source: 'distribution-crank',
          });
        }
        
        // Small delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await this.sleep(500);
        }
      }
      
      console.log(`✅ Distribution complete: ${result.usersDistributed} users, ${result.totalDistributed} lamports total`);
      
      // Update rate limiting tracking
      if (result.batches > 0) {
        this.lastDistributionTime = Date.now();
        this.distributionsThisHour.push({ timestamp: Date.now() });
      }
      
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
        
        // SECURITY: Validate discriminator
        const discriminator = data.slice(0, 8);
        if (!discriminator.equals(USER_STAKE_DISCRIMINATOR)) {
          await securityMonitor.log({
            severity: 'HIGH',
            category: 'Staking',
            eventType: SECURITY_EVENT_TYPES.STAKING_DISCRIMINATOR_INVALID,
            message: 'Invalid UserStake discriminator detected',
            details: {
              account: pubkey.toString(),
              expectedDiscriminator: USER_STAKE_DISCRIMINATOR.toString('hex'),
              receivedDiscriminator: discriminator.toString('hex'),
            },
            source: 'distribution-crank',
          });
          continue;
        }
        
        let offset = 8; // Skip discriminator
        
        // Read owner
        const ownerBytes = data.slice(offset, offset + 32);
        const owner = new PublicKey(ownerBytes);
        offset += 32;
        
        // Read pool
        const poolBytes = data.slice(offset, offset + 32);
        const pool = new PublicKey(poolBytes);
        offset += 32;
        
        // SECURITY: Validate pool matches
        if (!pool.equals(this.stakingPoolPDA)) {
          await securityMonitor.log({
            severity: 'MEDIUM',
            category: 'Staking',
            eventType: SECURITY_EVENT_TYPES.STAKING_POOL_MISMATCH,
            message: 'UserStake pool field mismatch',
            details: {
              account: pubkey.toString(),
              expectedPool: this.stakingPoolPDA?.toString(),
              actualPool: pool.toString(),
            },
            source: 'distribution-crank',
          });
          continue;
        }
        
        // SECURITY: Validate PDA derivation
        const [expectedPDA] = PublicKey.findProgramAddressSync(
          [USER_STAKE_SEED, this.stakingPoolPDA.toBuffer(), owner.toBuffer()],
          new PublicKey(PROGRAM_ID)
        );
        
        if (!pubkey.equals(expectedPDA)) {
          await securityMonitor.log({
            severity: 'HIGH',
            category: 'Staking',
            eventType: SECURITY_EVENT_TYPES.STAKING_PDA_MISMATCH,
            message: 'Invalid UserStake PDA detected - possible manipulation attempt',
            details: {
              expectedPDA: expectedPDA.toString(),
              receivedPDA: pubkey.toString(),
              owner: owner.toString(),
              epoch: forEpoch,
            },
            source: 'distribution-crank',
          });
          continue;
        }
        
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
      
      console.log(`✅ Security validation complete: ${eligible.length} eligible stakers verified`);
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
        
        // SECURITY: Simulate transaction first
        const tx = await this.program.methods
          .distributeRewards()
          .accounts({
            stakingPool: this.stakingPoolPDA,
            rewardVault: this.rewardVaultPDA,
            caller: this.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .transaction();
        
        // Add recent blockhash and fee payer
        const { blockhash } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;
        
        // Sign transaction
        tx.sign(this.wallet);
        
        // Simulate before sending
        const simulation = await this.connection.simulateTransaction(tx);
        
        if (simulation.value.err) {
          throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
        }
        
        // Send transaction
        const signature = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction(signature, 'confirmed');
        
        console.log(`📤 Distribution TX: ${signature}`);
        
        // Parse logs to get distributed amount
        let amountDistributed = BigInt(0);
        if (simulation.value.logs) {
          for (const log of simulation.value.logs) {
            if (log.includes('Distributed')) {
              const match = log.match(/Distributed (\d+) lamports/);
              if (match) {
                amountDistributed = BigInt(match[1]);
              }
            }
          }
        }
        
        return {
          success: true,
          usersDistributed: stakers.length,
          amountDistributed,
        };
        
      } catch (error: any) {
        console.error(`❌ Batch distribution attempt ${attempt} failed:`, error.message);
        
        // Exponential backoff
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        
        if (attempt < MAX_RETRIES) {
          console.log(`⏳ Retrying in ${delay}ms...`);
          await this.sleep(delay);
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