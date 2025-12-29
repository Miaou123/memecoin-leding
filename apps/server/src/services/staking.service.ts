import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { StakingStats, UserStake } from '@memecoin-lending/types';

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
}

export const stakingService = new StakingService();