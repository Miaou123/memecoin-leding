import { Show, createSignal, createEffect, createMemo } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { Button } from '@/components/ui/Button';
import { formatSOL, formatNumber, formatPercentage } from '@/lib/utils';
import { api } from '@/lib/api';

export default function Staking() {
  const [stakeAmount, setStakeAmount] = createSignal('');
  const [unstakeAmount, setUnstakeAmount] = createSignal('');
  const [userAddress] = createSignal('DummyUserAddress123'); // This would come from wallet connection

  // Queries
  const stakingStats = createQuery(() => ({
    queryKey: ['staking-stats'],
    queryFn: () => api.getStakingStats(),
  }));

  const userStake = createQuery(() => ({
    queryKey: ['user-stake', userAddress()],
    queryFn: () => api.getUserStake(userAddress()),
    enabled: !!userAddress(),
  }));

  // Calculated values
  const canStake = createMemo(() => {
    const amount = parseFloat(stakeAmount());
    return !isNaN(amount) && amount > 0;
  });

  const canUnstake = createMemo(() => {
    const amount = parseFloat(unstakeAmount());
    const userStaked = parseFloat(userStake.data?.stake?.stakedAmount || '0');
    return !isNaN(amount) && amount > 0 && amount <= userStaked / 1e9; // Convert from lamports
  });

  const handleStake = async () => {
    if (!canStake()) return;
    
    try {
      // In a real implementation, this would prepare and send the transaction
      console.log(`Staking ${stakeAmount()} tokens`);
      // Reset form
      setStakeAmount('');
      // Refetch user data
      userStake.refetch();
    } catch (error) {
      console.error('Stake failed:', error);
    }
  };

  const handleUnstake = async () => {
    if (!canUnstake()) return;
    
    try {
      // In a real implementation, this would prepare and send the transaction
      console.log(`Unstaking ${unstakeAmount()} tokens`);
      // Reset form
      setUnstakeAmount('');
      // Refetch user data
      userStake.refetch();
    } catch (error) {
      console.error('Unstake failed:', error);
    }
  };

  const handleClaimRewards = async () => {
    try {
      // In a real implementation, this would prepare and send the transaction
      console.log('Claiming rewards');
      // Refetch user data
      userStake.refetch();
    } catch (error) {
      console.error('Claim failed:', error);
    }
  };

  return (
    <div class="space-y-8 font-mono">
      {/* Terminal Header */}
      <div class="bg-bg-secondary border border-border p-6">
        <div class="text-xs text-text-dim mb-2">STAKING_MODULE v1.0.0</div>
        <div class="text-xl font-bold text-accent-blue mb-4">
          {">"} GOVERNANCE_TOKEN_STAKING.init()
        </div>
        <div class="text-text-primary mb-4">
          STAKE_GOVERNANCE_TOKENS {">"} EARN_SOL_REWARDS<br/>
          DYNAMIC_APR_SYSTEM {">"} TIME_WEIGHTED_EMISSIONS
        </div>
      </div>

      {/* Staking Pool Stats */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">STAKING_POOL_METRICS:</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">TOTAL_STAKED</div>
            <div class="text-lg font-bold text-accent-green">
              {stakingStats.isLoading ? '---' : formatNumber(parseFloat(stakingStats.data?.totalStaked || '0') / 1e9)}
            </div>
            <div class="text-xs text-text-secondary">TOKENS</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">TOTAL_STAKERS</div>
            <div class="text-lg font-bold text-accent-blue">
              {stakingStats.isLoading ? '---' : formatNumber(stakingStats.data?.totalStakers || 0)}
            </div>
            <div class="text-xs text-text-secondary">USERS</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">REWARD_POOL</div>
            <div class="text-lg font-bold text-accent-yellow">
              {stakingStats.isLoading ? '---' : formatSOL(stakingStats.data?.rewardPoolBalance || '0')}
            </div>
            <div class="text-xs text-text-secondary">SOL</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">CURRENT_APR</div>
            <div class="text-lg font-bold text-accent-green">
              {stakingStats.isLoading ? '---' : formatPercentage(stakingStats.data?.currentApr || 0)}
            </div>
            <div class="text-xs text-text-secondary">ANNUAL</div>
          </div>
        </div>
      </div>

      {/* User Stake Information */}
      <Show when={userAddress()}>
        <div class="space-y-4">
          <div class="text-xs text-text-dim">YOUR_STAKE_POSITION:</div>
          <div class="bg-bg-secondary border-2 border-accent-blue p-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div class="text-xs text-text-dim mb-1">STAKED_AMOUNT</div>
                <div class="text-xl font-bold text-accent-blue">
                  {userStake.isLoading ? '---' : formatNumber(parseFloat(userStake.data?.stake?.stakedAmount || '0') / 1e9)}
                </div>
                <div class="text-xs text-text-secondary">TOKENS</div>
              </div>
              <div>
                <div class="text-xs text-text-dim mb-1">PENDING_REWARDS</div>
                <div class="text-xl font-bold text-accent-green">
                  {userStake.isLoading ? '---' : formatSOL(userStake.data?.pendingRewards || '0')}
                </div>
                <div class="text-xs text-text-secondary">SOL</div>
              </div>
              <div>
                <div class="text-xs text-text-dim mb-1">REWARDS_SOL</div>
                <div class="text-xl font-bold text-accent-yellow">
                  {userStake.isLoading ? '---' : userStake.data?.pendingRewardsSol?.toFixed(4)}
                </div>
                <div class="text-xs text-text-secondary">SOL</div>
              </div>
            </div>
            
            <Show when={userStake.data?.pendingRewardsSol && userStake.data.pendingRewardsSol > 0}>
              <div class="mt-6 pt-4 border-t border-border">
                <Button 
                  onClick={handleClaimRewards}
                  class="w-full md:w-auto"
                  size="lg"
                >
                  [CLAIM_REWARDS]
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Staking Actions */}
      <div class="grid md:grid-cols-2 gap-6">
        {/* Stake Section */}
        <div class="bg-bg-secondary border border-border p-6">
          <div class="text-xs text-text-dim mb-4">STAKE_TOKENS:</div>
          
          <div class="space-y-4">
            <div>
              <label class="text-xs text-text-dim block mb-2">AMOUNT_TO_STAKE:</label>
              <input
                type="number"
                placeholder="0.00"
                value={stakeAmount()}
                onInput={(e) => setStakeAmount(e.target.value)}
                class="w-full bg-bg-primary border border-border p-3 font-mono text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-green"
              />
            </div>
            
            <div class="text-xs text-text-secondary">
              MIN_STAKE: 1 TOKEN<br/>
              AVAILABLE: --- TOKENS {/* Would show actual balance */}
            </div>
            
            <Button
              onClick={handleStake}
              disabled={!canStake()}
              class="w-full"
              size="lg"
            >
              [EXECUTE_STAKE]
            </Button>
          </div>
        </div>

        {/* Unstake Section */}
        <div class="bg-bg-secondary border border-border p-6">
          <div class="text-xs text-text-dim mb-4">UNSTAKE_TOKENS:</div>
          
          <div class="space-y-4">
            <div>
              <label class="text-xs text-text-dim block mb-2">AMOUNT_TO_UNSTAKE:</label>
              <input
                type="number"
                placeholder="0.00"
                value={unstakeAmount()}
                onInput={(e) => setUnstakeAmount(e.target.value)}
                class="w-full bg-bg-primary border border-border p-3 font-mono text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-yellow"
              />
            </div>
            
            <div class="text-xs text-text-secondary">
              STAKED_BALANCE: {formatNumber(parseFloat(userStake.data?.stake?.stakedAmount || '0') / 1e9)} TOKENS<br/>
              INSTANT_WITHDRAWAL: NO_COOLDOWN
            </div>
            
            <Button
              onClick={handleUnstake}
              disabled={!canUnstake()}
              variant="outline"
              class="w-full"
              size="lg"
            >
              [EXECUTE_UNSTAKE]
            </Button>
          </div>
        </div>
      </div>

      {/* Emission Information */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">EMISSION_ALGORITHM:</div>
        <div class="bg-bg-secondary border border-border p-6">
          <div class="grid md:grid-cols-2 gap-6">
            <div>
              <div class="text-sm font-bold text-text-primary mb-4">DYNAMIC_EMISSION_SYSTEM</div>
              <div class="space-y-2 text-xs text-text-secondary">
                <div>• REWARD_RATE = f(POOL_BALANCE, TARGET_BALANCE)</div>
                <div>• HIGHER_POOL_BALANCE → HIGHER_EMISSIONS</div>
                <div>• TIME_WEIGHTED_ACCUMULATOR_PATTERN</div>
                <div>• AUTOMATIC_APR_ADJUSTMENT</div>
              </div>
            </div>
            <div>
              <div class="text-sm font-bold text-text-primary mb-4">CURRENT_PARAMETERS</div>
              <div class="space-y-2 text-xs">
                <div class="flex justify-between">
                  <span class="text-text-dim">EMISSION_RATE:</span>
                  <span class="text-accent-green">{stakingStats.data?.emissionRate ? formatSOL(stakingStats.data.emissionRate) : '---'} SOL/SEC</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-text-dim">BASE_RATE:</span>
                  <span class="text-text-secondary">1.000 SOL/SEC</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-text-dim">MAX_RATE:</span>
                  <span class="text-text-secondary">10.000 SOL/SEC</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-text-dim">MIN_RATE:</span>
                  <span class="text-text-secondary">0.100 SOL/SEC</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fee Distribution */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">CREATOR_FEE_DISTRIBUTION:</div>
        <div class="bg-bg-secondary border border-border p-6">
          <div class="grid grid-cols-3 gap-4">
            <div class="text-center">
              <div class="text-2xl font-bold text-accent-green mb-2">50%</div>
              <div class="text-xs text-text-dim">TREASURY</div>
              <div class="text-xs text-text-secondary">Protocol Operations</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-accent-blue mb-2">25%</div>
              <div class="text-xs text-text-dim">STAKING_POOL</div>
              <div class="text-xs text-text-secondary">Reward Distribution</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-accent-yellow mb-2">25%</div>
              <div class="text-xs text-text-dim">DEVELOPMENT</div>
              <div class="text-xs text-text-secondary">Team & Growth</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}