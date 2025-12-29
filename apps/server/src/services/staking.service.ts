import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { StakingStats, UserStake, DEFAULT_FEE_CONFIG, FeeDistributionConfig } from '@memecoin-lending/types';

class StakingService {
  async getStakingStats(): Promise<StakingStats> {
    return {
      totalStaked: '1000000',
      totalStakers: 42,
      rewardPoolBalance: '50000000000',
      currentApr: 125.5,
      emissionRate: '1000000',
    };
  }
  
  async getUserStake(address: string): Promise<UserStake | null> {
    return {
      owner: address,
      pool: '',
      stakedAmount: '50000',
      rewardPerTokenPaid: '0',
      pendingRewards: '0',
      stakeTimestamp: Math.floor(Date.now() / 1000),
    };
  }
  
  async getPendingRewards(address: string): Promise<{ pending: string; pendingSol: number }> {
    const mockPending = 1500000000;
    return {
      pending: mockPending.toString(),
      pendingSol: mockPending / LAMPORTS_PER_SOL,
    };
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