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
  devWallet: string;
  stakingRewardVault: string;
  treasurySplitBps: number;
  stakingSplitBps: number;
  devSplitBps: number;
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
