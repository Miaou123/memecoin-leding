import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { StakingStats, UserStake, DEFAULT_FEE_CONFIG, FeeDistributionConfig } from '@memecoin-lending/types';
import { getStakingPoolPDA, getRewardVaultPDA, deriveUserStakePDA, PROGRAM_ID } from '@memecoin-lending/config';

// Helper functions for reading account data
function readU64(buffer: Buffer, offset: number): BN {
  return new BN(buffer.slice(offset, offset + 8), 'le');
}

function readU128(buffer: Buffer, offset: number): BN {
  return new BN(buffer.slice(offset, offset + 16), 'le');
}

function readI64(buffer: Buffer, offset: number): BN {
  return new BN(buffer.slice(offset, offset + 8), 'le');
}

function readPubkey(buffer: Buffer, offset: number): PublicKey {
  return new PublicKey(buffer.slice(offset, offset + 32));
}

class StakingService {
  private connection: Connection;
  
  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }
  
  
  async getStakingStats(): Promise<StakingStats> {
    try {
      // Get PDAs from deployment file
      const stakingPoolPDA = getStakingPoolPDA();
      const rewardVaultPDA = getRewardVaultPDA();
      
      if (!stakingPoolPDA || !rewardVaultPDA) {
        throw new Error('Staking PDAs not found in deployment file');
      }
      
      // Fetch reward vault SOL balance
      const rewardVaultBalance = await this.connection.getBalance(rewardVaultPDA);
      
      // Fetch staking pool account
      const stakingPoolAccount = await this.connection.getAccountInfo(stakingPoolPDA);
      
      if (!stakingPoolAccount || !stakingPoolAccount.data) {
        console.log('🔍 Staking pool account not found, returning zeros');
        return {
          totalStaked: '0',
          totalStakers: 0,
          rewardPoolBalance: rewardVaultBalance.toString(),
          currentApr: 0,
          emissionRate: '0',
        };
      }
      
      // Deserialize staking pool account (skip 8-byte discriminator)
      // New Rust struct layout with accumulator:
      // pub struct StakingPool {
      //     pub authority: Pubkey,              // 32 bytes
      //     pub staking_token_mint: Pubkey,     // 32 bytes
      //     pub staking_vault: Pubkey,          // 32 bytes
      //     pub reward_vault: Pubkey,           // 32 bytes
      //     pub current_epoch: u64,             // 8 bytes
      //     pub epoch_duration: i64,            // 8 bytes
      //     pub epoch_start_time: i64,          // 8 bytes
      //     pub total_staked: u64,              // 8 bytes
      //     pub current_epoch_eligible_stake: u64, // 8 bytes
      //     pub reward_per_token_accumulated: u128, // 16 bytes
      //     pub current_epoch_rewards: u64,     // 8 bytes
      //     pub total_rewards_distributed: u64, // 8 bytes
      //     pub total_rewards_deposited: u64,   // 8 bytes
      //     pub total_epochs_completed: u64,    // 8 bytes
      //     pub paused: bool,                   // 1 byte
      //     pub bump: u8,                       // 1 byte
      //     pub _reserved: [u8; 64],            // 64 bytes
      // }
      
      const data = stakingPoolAccount.data;
      let offset = 8; // Skip discriminator
      
      const authority = readPubkey(data, offset); offset += 32;
      const stakingTokenMint = readPubkey(data, offset); offset += 32;
      const stakingVault = readPubkey(data, offset); offset += 32;
      const rewardVault = readPubkey(data, offset); offset += 32;
      const currentEpoch = readU64(data, offset); offset += 8;
      const epochDuration = readI64(data, offset); offset += 8;
      const epochStartTime = readI64(data, offset); offset += 8;
      const totalStaked = readU64(data, offset); offset += 8;
      const currentEpochEligibleStake = readU64(data, offset); offset += 8;
      const rewardPerTokenAccumulated = readU128(data, offset); offset += 16;
      const currentEpochRewards = readU64(data, offset); offset += 8;
      const totalRewardsDistributed = readU64(data, offset); offset += 8;
      const totalRewardsDeposited = readU64(data, offset); offset += 8;
      const totalEpochsCompleted = readU64(data, offset); offset += 8;
      const paused = data[offset] !== 0; offset += 1;
      const bump = data[offset]; offset += 1;
      
      // Count total stakers by querying all UserStake PDAs
      let totalStakers = new BN(0);
      try {
        // Get all UserStake accounts for this staking pool
        const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
        const userStakeAccounts = await this.connection.getProgramAccounts(
          programId,
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
                  bytes: stakingPoolPDA.toBase58(),
                },
              },
            ],
          }
        );
        
        // Count accounts with non-zero stakes
        let activeStakers = 0;
        for (const account of userStakeAccounts) {
          try {
            let offset = 8 + 32 + 32; // Skip discriminator + owner + pool
            const stakedAmount = readU64(account.account.data, offset);
            if (stakedAmount.gt(new BN(0))) {
              activeStakers++;
            }
          } catch (e) {
            // Skip invalid accounts
            continue;
          }
        }
        
        totalStakers = new BN(activeStakers);
        console.log(`👥 Found ${activeStakers} active stakers`);
      } catch (error) {
        console.warn('⚠️ Could not query staker count, using 0:', error);
        totalStakers = new BN(0);
      }
      
      // Calculate time until next epoch
      const currentTime = Math.floor(Date.now() / 1000);
      const epochEndTime = epochStartTime.toNumber() + epochDuration.toNumber();
      const timeUntilNextEpoch = Math.max(0, epochEndTime - currentTime);
      
      // For epoch-based system, APR is calculated differently
      // Based on historical rewards distributed
      let currentApr = 0;
      if (totalStaked.gt(new BN(0)) && totalRewardsDistributed.gt(new BN(0)) && totalEpochsCompleted.gt(new BN(0))) {
        // Average rewards per epoch
        const avgRewardsPerEpoch = totalRewardsDistributed.div(totalEpochsCompleted);
        // Epochs per year
        const epochsPerYear = new BN(365 * 24 * 3600).div(epochDuration);
        // Annual rewards
        const annualRewards = avgRewardsPerEpoch.mul(epochsPerYear);
        // APR = (annual rewards / total staked) * 100
        const aprBasisPoints = annualRewards.mul(new BN(10000)).div(totalStaked);
        currentApr = aprBasisPoints.toNumber() / 100;
      }
      
      console.log('📊 Staking pool state:', {
        totalStaked: totalStaked.toString(),
        totalStakers: totalStakers.toNumber(),
        rewardPoolBalance: rewardVaultBalance,
        currentEpoch: currentEpoch.toString(),
        timeUntilNextEpoch,
        currentEpochRewards: currentEpochRewards.toString(),
        rewardPerTokenAccumulated: rewardPerTokenAccumulated.toString(),
        paused
      });
      
      return {
        totalStaked: totalStaked.toString(),
        totalStakers: totalStakers.toNumber(),
        rewardPoolBalance: rewardVaultBalance.toString(),
        currentApr,
        emissionRate: '0', // No longer used in epoch-based system
        currentEpoch: currentEpoch.toNumber(),
        epochDuration: epochDuration.toNumber(),
        timeUntilNextEpoch,
        currentEpochRewards: currentEpochRewards.toString(),
        currentEpochEligibleStake: currentEpochEligibleStake.toString(),
        rewardPerTokenAccumulated: rewardPerTokenAccumulated.toString(),
        totalRewardsDistributed: totalRewardsDistributed.toString(),
        totalRewardsDeposited: totalRewardsDeposited.toString(),
      };
      
    } catch (error: any) {
      console.error('❌ Failed to fetch staking stats:', error.message);
      // Return default values on error
      return {
        totalStaked: '0',
        totalStakers: 0,
        rewardPoolBalance: '0',
        currentApr: 0,
        emissionRate: '0',
        currentEpoch: 0,
        timeUntilNextEpoch: 0,
        epochRewards: '0',
        eligibleStake: '0',
      };
    }
  }
  
  async getUserStake(address: string): Promise<UserStake | null> {
    try {
      if (!address) return null;
      
      // Parse address to PublicKey
      const userPubkey = new PublicKey(address);
      
      // Derive PDAs
      const stakingPoolPDA = getStakingPoolPDA();
      if (!stakingPoolPDA) {
        throw new Error('Staking pool PDA not found in deployment');
      }
      const [userStakePDA] = deriveUserStakePDA(stakingPoolPDA, userPubkey);
      
      // Fetch account info
      const accountInfo = await this.connection.getAccountInfo(userStakePDA);
      
      if (!accountInfo || !accountInfo.data) {
        console.log(`🔍 User stake not found for ${address}`);
        return null;
      }
      
      // Deserialize user stake account (skip 8-byte discriminator)
      // New struct with accumulator fields:
      // pub struct UserStake {
      //     pub owner: Pubkey,                     // 32 bytes
      //     pub pool: Pubkey,                      // 32 bytes  
      //     pub staked_amount: u64,                // 8 bytes
      //     pub stake_start_epoch: u64,            // 8 bytes
      //     pub reward_per_token_snapshot: u128,   // 16 bytes
      //     pub snapshot_initialized: bool,        // 1 byte
      //     pub last_claimed_epoch: u64,           // 8 bytes
      //     pub total_rewards_claimed: u64,        // 8 bytes
      //     pub first_stake_time: i64,             // 8 bytes
      //     pub bump: u8,                          // 1 byte
      //     pub _reserved: [u8; 32],               // 32 bytes
      // }
      const data = accountInfo.data;
      let offset = 8; // Skip discriminator
      
      const owner = readPubkey(data, offset); offset += 32;
      const pool = readPubkey(data, offset); offset += 32;
      const stakedAmount = readU64(data, offset); offset += 8;
      const stakeStartEpoch = readU64(data, offset); offset += 8;
      const rewardPerTokenSnapshot = readU128(data, offset); offset += 16;
      const snapshotInitialized = data[offset] !== 0; offset += 1;
      const lastClaimedEpoch = readU64(data, offset); offset += 8;
      const totalRewardsClaimed = readU64(data, offset); offset += 8;
      const firstStakeTime = readI64(data, offset); offset += 8;
      const bump = data[offset];
      
      return {
        owner: owner.toString(),
        pool: pool.toString(),
        stakedAmount: stakedAmount.toString(),
        stakeStartEpoch: stakeStartEpoch.toNumber(),
        rewardPerTokenSnapshot: rewardPerTokenSnapshot.toString(),
        snapshotInitialized,
        lastClaimedEpoch: lastClaimedEpoch.toNumber(),
        totalRewardsClaimed: totalRewardsClaimed.toString(),
        firstStakeTime: firstStakeTime.toNumber(),
        bump,
      };
      
    } catch (error: any) {
      console.error('❌ Failed to fetch user stake:', error.message);
      return null;
    }
  }
  
  async getPendingRewards(address: string): Promise<{ pending: string; pendingSol: number; isEligibleCurrentEpoch: boolean }> {
    try {
      // Get user stake
      const userStake = await this.getUserStake(address);
      
      if (!userStake || userStake.stakedAmount === '0') {
        return { pending: '0', pendingSol: 0, isEligibleCurrentEpoch: false };
      }
      
      // Not eligible yet
      if (!userStake.snapshotInitialized) {
        return { pending: '0', pendingSol: 0, isEligibleCurrentEpoch: false };
      }
      
      const stats = await this.getStakingStats();
      if (!stats) {
        return { pending: '0', pendingSol: 0, isEligibleCurrentEpoch: false };
      }
      
      // Calculate using accumulator: rewards = stake * (current_rpt - user_snapshot) / PRECISION
      const PRECISION = BigInt('1000000000000'); // 1e12
      const stakedAmount = BigInt(userStake.stakedAmount);
      const currentRpt = BigInt(stats.rewardPerTokenAccumulated);
      const userSnapshot = BigInt(userStake.rewardPerTokenSnapshot);
      
      if (currentRpt <= userSnapshot) {
        return { pending: '0', pendingSol: 0, isEligibleCurrentEpoch: true };
      }
      
      const rptDiff = currentRpt - userSnapshot;
      const rewards = (stakedAmount * rptDiff) / PRECISION;
      
      return {
        pending: rewards.toString(),
        pendingSol: Number(rewards) / LAMPORTS_PER_SOL,
        isEligibleCurrentEpoch: true,
      };
      
    } catch (error: any) {
      console.error('❌ Failed to calculate pending rewards:', error.message);
      return { pending: '0', pendingSol: 0, isEligibleCurrentEpoch: false };
    }
  }


  // Fee configuration methods
  getFeeConfig(): FeeDistributionConfig {
    return DEFAULT_FEE_CONFIG;
  }
  
  getFeeBreakdown() {
    return {
      loanFee: {
        totalPercent: 2.0,
        treasury: { percent: 1.0, description: '50% of 2% fee' },
        staking: { percent: 0.5, description: '25% of 2% fee' },
        operations: { percent: 0.5, description: '25% of 2% fee' },
      },
      creatorFee: {
        treasury: { percent: 40, description: '40% of creator fees' },
        staking: { percent: 40, description: '40% of creator fees' },
        operations: { percent: 20, description: '20% of creator fees' },
      },
      liquidation: {
        treasury: { percent: 95, description: '95% of surplus' },
        operations: { percent: 5, description: '5% of surplus' },
      },
    };
  }
}

export const stakingService = new StakingService();