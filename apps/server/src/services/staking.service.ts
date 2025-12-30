import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { StakingStats, UserStake, DEFAULT_FEE_CONFIG, FeeDistributionConfig } from '@memecoin-lending/types';

// Program ID
const PROGRAM_ID = new PublicKey('CD2sN1enC22Nyw6U6s2dYcxfbtsLVq2PhbomLBkyh1z5');

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
  
  private getStakingPoolPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool')],
      PROGRAM_ID
    );
  }
  
  private getRewardVaultPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault')],
      PROGRAM_ID
    );
  }
  
  private getUserStakePDA(stakingPool: PublicKey, user: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
      PROGRAM_ID
    );
  }
  
  async getStakingStats(): Promise<StakingStats> {
    try {
      // Derive PDAs
      const [stakingPoolPDA] = this.getStakingPoolPDA();
      const [rewardVaultPDA] = this.getRewardVaultPDA();
      
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
      const data = stakingPoolAccount.data;
      let offset = 8; // Skip discriminator
      
      const authority = readPubkey(data, offset); offset += 32;
      const stakingTokenMint = readPubkey(data, offset); offset += 32;
      const stakingVault = readPubkey(data, offset); offset += 32;
      const rewardVault = readPubkey(data, offset); offset += 32;
      const totalStaked = readU64(data, offset); offset += 8;
      const totalStakers = readU64(data, offset); offset += 8;
      const rewardPerTokenStored = readU128(data, offset); offset += 16;
      const lastUpdateTime = readI64(data, offset); offset += 8;
      const targetPoolBalance = readU64(data, offset); offset += 8;
      const baseEmissionRate = readU64(data, offset); offset += 8;
      const maxEmissionRate = readU64(data, offset); offset += 8;
      const minEmissionRate = readU64(data, offset); offset += 8;
      const currentEmissionRate = readU64(data, offset); offset += 8;
      const paused = data[offset]; offset += 1;
      const bump = data[offset];
      
      // Calculate APR: (currentEmissionRate * 365 * 24 * 3600 * 100) / totalStaked
      let currentApr = 0;
      if (totalStaked.gt(new BN(0))) {
        const secondsPerYear = 365 * 24 * 3600;
        const annualEmission = currentEmissionRate.mul(new BN(secondsPerYear));
        currentApr = annualEmission.mul(new BN(100)).div(totalStaked).toNumber();
      }
      
      console.log('📊 Staking pool state:', {
        totalStaked: totalStaked.toString(),
        totalStakers: totalStakers.toNumber(),
        rewardPoolBalance: rewardVaultBalance,
        currentApr: currentApr.toFixed(2) + '%',
        currentEmissionRate: currentEmissionRate.toString(),
        paused
      });
      
      return {
        totalStaked: totalStaked.toString(),
        totalStakers: totalStakers.toNumber(),
        rewardPoolBalance: rewardVaultBalance.toString(),
        currentApr,
        emissionRate: currentEmissionRate.toString(),
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
      };
    }
  }
  
  async getUserStake(address: string): Promise<UserStake | null> {
    try {
      if (!address) return null;
      
      // Parse address to PublicKey
      const userPubkey = new PublicKey(address);
      
      // Derive PDAs
      const [stakingPoolPDA] = this.getStakingPoolPDA();
      const [userStakePDA] = this.getUserStakePDA(stakingPoolPDA, userPubkey);
      
      // Fetch account info
      const accountInfo = await this.connection.getAccountInfo(userStakePDA);
      
      if (!accountInfo || !accountInfo.data) {
        console.log(`🔍 User stake not found for ${address}`);
        return null;
      }
      
      // Deserialize user stake account (skip 8-byte discriminator)
      const data = accountInfo.data;
      let offset = 8; // Skip discriminator
      
      const owner = readPubkey(data, offset); offset += 32;
      const pool = readPubkey(data, offset); offset += 32;
      const stakedAmount = readU64(data, offset); offset += 8;
      const rewardPerTokenPaid = readU128(data, offset); offset += 16;
      const pendingRewards = readU64(data, offset); offset += 8;
      const stakeTimestamp = readI64(data, offset); offset += 8;
      const bump = data[offset];
      
      return {
        owner: owner.toString(),
        pool: pool.toString(),
        stakedAmount: stakedAmount.toString(),
        rewardPerTokenPaid: rewardPerTokenPaid.toString(),
        pendingRewards: pendingRewards.toString(),
        stakeTimestamp: stakeTimestamp.toNumber(),
      };
      
    } catch (error: any) {
      console.error('❌ Failed to fetch user stake:', error.message);
      return null;
    }
  }
  
  async getPendingRewards(address: string): Promise<{ pending: string; pendingSol: number }> {
    try {
      // Get user stake
      const userStake = await this.getUserStake(address);
      
      if (!userStake) {
        return {
          pending: '0',
          pendingSol: 0,
        };
      }
      
      // Fetch current staking pool state to get latest rewardPerTokenStored
      const [stakingPoolPDA] = this.getStakingPoolPDA();
      const stakingPoolAccount = await this.connection.getAccountInfo(stakingPoolPDA);
      
      if (!stakingPoolAccount || !stakingPoolAccount.data) {
        return {
          pending: '0',
          pendingSol: 0,
        };
      }
      
      // Parse current reward per token from pool state
      const data = stakingPoolAccount.data;
      let offset = 8 + 32 + 32 + 32 + 32 + 8 + 8; // Skip to rewardPerTokenStored
      const currentRewardPerToken = readU128(data, offset);
      
      // Calculate pending rewards
      const stakedAmount = new BN(userStake.stakedAmount);
      const userRewardPerTokenPaid = new BN(userStake.rewardPerTokenPaid);
      const pendingRewardsStored = new BN(userStake.pendingRewards);
      
      // earned = (stakedAmount * (rewardPerToken - userRewardPerTokenPaid)) / 1e18 + pendingRewards
      const rewardPerTokenDiff = currentRewardPerToken.sub(userRewardPerTokenPaid);
      const earnedFromStaking = stakedAmount.mul(rewardPerTokenDiff).div(new BN('1000000000000000000')); // div by 1e18
      const totalEarned = earnedFromStaking.add(pendingRewardsStored);
      
      const pendingSol = totalEarned.toNumber() / LAMPORTS_PER_SOL;
      
      return {
        pending: totalEarned.toString(),
        pendingSol,
      };
      
    } catch (error: any) {
      console.error('❌ Failed to calculate pending rewards:', error.message);
      return {
        pending: '0',
        pendingSol: 0,
      };
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