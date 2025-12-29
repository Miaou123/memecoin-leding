export interface StakingPool {
  authority: string;
  stakingTokenMint: string;
  stakingVault: string;
  rewardVault: string;
  totalStaked: string;
  rewardPerTokenStored: string;
  lastUpdateTime: number;
  targetPoolBalance: string;
  baseEmissionRate: string;
  maxEmissionRate: string;
  minEmissionRate: string;
  totalRewardsDistributed: string;
  totalRewardsDeposited: string;
  paused: boolean;
}

export interface UserStake {
  owner: string;
  pool: string;
  stakedAmount: string;
  rewardPerTokenPaid: string;
  pendingRewards: string;
  stakeTimestamp: number;
}

export interface FeeReceiver {
  authority: string;
  treasuryWallet: string;
  operationsWallet: string;      // RENAMED from devWallet
  stakingRewardVault: string;
  treasurySplitBps: number;      // Default: 4000 (40%)
  stakingSplitBps: number;       // Default: 4000 (40%)
  operationsSplitBps: number;    // Default: 2000 (20%) - RENAMED
  totalFeesReceived: string;
  totalFeesDistributed: string;
}

export interface StakingStats {
  totalStaked: string;
  totalStakers: number;
  rewardPoolBalance: string;
  currentApr: number;
  emissionRate: string;
  userStake?: UserStake;
  userPendingRewards?: string;
}

export interface StakeParams {
  amount: string;
}

export interface UnstakeParams {
  amount: string;
}

export interface FeeDistributionConfig {
  // Loan fees (2% total, distributed as percentages of that 2%)
  loanFeeTreasuryBps: number;      // 5000 = 50% of 2% = 1.0%
  loanFeeStakingBps: number;       // 2500 = 25% of 2% = 0.5%
  loanFeeOperationsBps: number;    // 2500 = 25% of 2% = 0.5%
  
  // Creator fees (staker-focused)
  creatorFeeTreasuryBps: number;      // 4000 = 40%
  creatorFeeStakingBps: number;       // 4000 = 40%
  creatorFeeOperationsBps: number;    // 2000 = 20%
}

export const DEFAULT_FEE_CONFIG: FeeDistributionConfig = {
  // Loan fee splits (of the 2% fee)
  loanFeeTreasuryBps: 5000,      // 50% → 1.0%
  loanFeeStakingBps: 2500,       // 25% → 0.5%
  loanFeeOperationsBps: 2500,    // 25% → 0.5%
  
  // Creator fee splits (staker-focused)
  creatorFeeTreasuryBps: 4000,      // 40%
  creatorFeeStakingBps: 4000,       // 40%
  creatorFeeOperationsBps: 2000,    // 20%
};
