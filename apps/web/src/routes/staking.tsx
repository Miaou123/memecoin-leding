import { Show, createSignal, createMemo } from 'solid-js';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import { Button } from '@/components/ui/Button';
import { formatNumber, formatPercentage } from '@/lib/utils';
import { api } from '@/lib/api';
import { useWallet } from '@/components/wallet/WalletProvider';
import { buildStakeTransaction, buildUnstakeTransaction, simulateTransaction } from '@/lib/staking-transactions';
import { getStakingConfig, type Network } from '@memecoin-lending/config';
import { EpochCountdown } from '@/components/EpochCountdown';

// Helper functions for formatting
const formatSol = (lamports: string | number) => {
  const sol = Number(lamports) / 1e9;
  return sol.toLocaleString(undefined, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 4 
  });
};

const formatUsd = (usdValue: number) => {
  return usdValue.toLocaleString(undefined, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

export default function Staking() {
  // Get network from env
  const NETWORK = (import.meta.env.VITE_SOLANA_NETWORK || 'devnet') as Network;
  const stakingConfig = getStakingConfig(NETWORK);
  const STAKING_TOKEN_MINT = stakingConfig?.stakingTokenMint;
  
  const [stakeAmount, setStakeAmount] = createSignal('');
  const [unstakeAmount, setUnstakeAmount] = createSignal('');
  const [activeTab, setActiveTab] = createSignal<'STAKE' | 'UNSTAKE'>('STAKE');
  const [solPrice] = createSignal(134); // Default SOL price, could be fetched from API
  
  // Get wallet context
  const wallet = useWallet();

  // Queries
  const stakingStats = createQuery(() => ({
    queryKey: ['staking-stats'],
    queryFn: () => api.getStakingStats(),
  }));

  const userStake = createQuery(() => ({
    queryKey: ['user-stake', wallet.publicKey()?.toString()],
    queryFn: () => api.getUserStake(wallet.publicKey()?.toString() || ''),
    enabled: !!wallet.publicKey(),
    refetchInterval: 5000, // Refresh every 5 seconds to show live pending rewards
  }));
  
  // User token balance query
  const userTokenBalance = createQuery(() => ({
    queryKey: ['userTokenBalance', wallet.publicKey()?.toString(), STAKING_TOKEN_MINT],
    queryFn: async () => {
      if (!wallet.publicKey() || !STAKING_TOKEN_MINT) return '0';
      
      const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL);
      const mint = new PublicKey(STAKING_TOKEN_MINT);
      const ata = await getAssociatedTokenAddress(mint, wallet.publicKey()!);
      
      try {
        const balance = await connection.getTokenAccountBalance(ata);
        return balance.value.uiAmountString || '0';
      } catch {
        return '0'; // Account doesn't exist
      }
    },
    enabled: !!wallet.publicKey() && !!STAKING_TOKEN_MINT,
    refetchInterval: 30000,
  }));

  // Calculated values
  const canStake = createMemo(() => {
    const amount = parseFloat(stakeAmount());
    return !isNaN(amount) && amount > 0;
  });

  const canUnstake = createMemo(() => {
    const amount = parseFloat(unstakeAmount());
    const userStaked = parseFloat(userStake.data?.stake?.stakedAmount || '0');
    return !isNaN(amount) && amount > 0 && amount <= userStaked / 1e6; // Convert from 6 decimals
  });

  // Stake mutation
  const stakeMutation = createMutation(() => ({
    mutationFn: async () => {
      if (!wallet.publicKey() || !STAKING_TOKEN_MINT) {
        throw new Error('Wallet not connected or staking token not configured');
      }
      
      const amount = parseFloat(stakeAmount());
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid stake amount');
      }
      const rawAmount = new BN(Math.floor(amount * 1e6)); // 6 decimals for pumpfun
      
      const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL);
      
      // Build transaction
      const transaction = await buildStakeTransaction(
        wallet.publicKey()!,
        rawAmount,
        connection
      );
      
      // SECURITY: Simulate transaction first
      const simulationResult = await simulateTransaction(transaction, connection);
      if (!simulationResult.success) {
        throw new Error(simulationResult.error);
      }
      
      // Sign and send
      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log('Stake transaction:', signature);
      return { amount, signature };
    },
    onSuccess: (data) => {
      console.log(`Successfully staked ${data.amount} tokens!`);
      setStakeAmount('');
      // Refetch all data
      userStake.refetch();
      userTokenBalance.refetch();
      stakingStats.refetch();
    },
    onError: (error) => {
      console.error('Stake failed:', error);
      alert(`Stake failed: ${error.message}`);
    }
  }));
  
  const handleStake = () => {
    stakeMutation.mutate();
  };

  // Unstake mutation
  const unstakeMutation = createMutation(() => ({
    mutationFn: async () => {
      if (!wallet.publicKey() || !STAKING_TOKEN_MINT) {
        throw new Error('Wallet not connected or staking token not configured');
      }
      
      const amount = parseFloat(unstakeAmount());
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid unstake amount');
      }
      const rawAmount = new BN(Math.floor(amount * 1e6)); // 6 decimals for pumpfun
      
      const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL);
      
      // Build transaction
      const transaction = await buildUnstakeTransaction(
        wallet.publicKey()!,
        rawAmount,
        connection
      );
      
      // SECURITY: Simulate transaction first
      const simulationResult = await simulateTransaction(transaction, connection);
      if (!simulationResult.success) {
        throw new Error(simulationResult.error);
      }
      
      // Sign and send
      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log('Unstake transaction:', signature);
      return { amount, signature };
    },
    onSuccess: (data) => {
      console.log(`Successfully unstaked ${data.amount} tokens!`);
      setUnstakeAmount('');
      // Refetch all data
      userStake.refetch();
      userTokenBalance.refetch();
      stakingStats.refetch();
    },
    onError: (error) => {
      console.error('Unstake failed:', error);
      alert(`Unstake failed: ${error.message}`);
    }
  }));
  
  const handleUnstake = () => {
    unstakeMutation.mutate();
  };


  return (
    <div class="space-y-6 font-mono">
      {/* Module Header */}
      <div class="bg-bg-secondary border border-border p-6">
        <div class="text-xs text-text-dim uppercase tracking-wider mb-2">STAKING_MODULE v1.0.0</div>
        <div class="text-xl font-bold text-accent-blue mb-3">
          {">"} GOVERNANCE_TOKEN_STAKING.init()
        </div>
        <div class="text-sm text-text-primary leading-relaxed">
          STAKE_GOVERNANCE_TOKENS {">"} EARN_SOL_REWARDS | DYNAMIC_APR_SYSTEM {">"} TIME_WEIGHTED_EMISSIONS
        </div>
      </div>

      {/* Horizontal Stats Bar */}
      <div class="flex justify-center gap-8 py-4 border-y border-border">
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-green">
            {stakingStats.isLoading ? '---' : formatNumber(parseFloat(stakingStats.data?.totalStaked || '0') / 1e6)}
          </div>
          <div class="text-text-dim text-xs">TOTAL_STAKED</div>
        </div>
        <div class="w-px bg-border"></div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-blue">
            {stakingStats.isLoading ? '---' : `#${stakingStats.data?.currentEpoch || 0}`}
          </div>
          <div class="text-text-dim text-xs">CURRENT_EPOCH</div>
        </div>
        <div class="w-px bg-border"></div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-yellow">
            {stakingStats.isLoading ? '---' : formatSol(stakingStats.data?.totalRewardsDistributed || '0')} SOL
          </div>
          <div class="text-text-dim text-xs">TOTAL_DISTRIBUTED</div>
          <div class="text-text-dim text-xs">≈ ${formatUsd((parseFloat(stakingStats.data?.totalRewardsDistributed || '0') / 1e9) * solPrice())}</div>
        </div>
        <div class="w-px bg-border"></div>
        
        <Show when={stakingStats.data?.timeUntilNextEpoch !== undefined}>
          <EpochCountdown timeUntilNextEpoch={stakingStats.data?.timeUntilNextEpoch ?? 0} />
        </Show>
        <Show when={!stakingStats.data?.timeUntilNextEpoch}>
          <div class="text-center">
            <div class="text-2xl font-bold text-accent-blue">---</div>
            <div class="text-text-dim text-xs">NEXT_EPOCH_IN</div>
          </div>
        </Show>
        <div class="w-px bg-border"></div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-green">
            {stakingStats.isLoading ? '---' : formatPercentage(stakingStats.data?.currentApr || 0)}
          </div>
          <div class="text-text-dim text-xs">CURRENT_APR</div>
        </div>
      </div>

      {/* Two-Column Main Section */}
      <div class="grid md:grid-cols-2 gap-6">
        {/* Left Column - YOUR_POSITION */}
        <div class="space-y-4">
          <div class="bg-bg-secondary border border-border">
            {/* Header row inside card */}
            <div class="flex justify-between items-center p-4 border-b border-border">
              <span class="text-xs text-text-dim uppercase tracking-wider">YOUR_POSITION</span>
              <span class="border border-accent-green bg-bg-tertiary text-accent-green px-2 py-1 text-xs">
                {stakingStats.isLoading ? '---' : formatPercentage(stakingStats.data?.currentApr || 0)} APR
              </span>
            </div>
            {/* Content */}
            <div class="p-6">
              {/* big staked number centered */}
              <div class="text-center mb-6">
                <div style="font-size: 32px" class="font-bold text-accent-green mb-2 leading-none">
                  {userStake.isLoading ? '---' : formatNumber(parseFloat(userStake.data?.stake?.stakedAmount || '0') / 1e6)}
                </div>
                <div class="text-xs text-text-dim uppercase tracking-wider">TOKENS STAKED</div>
              </div>
              
              {/* total rewards box */}
              <div class="bg-bg-tertiary border border-border p-4 mb-6">
                <div class="text-xs text-text-dim uppercase tracking-wider mb-2">YOUR_TOTAL_REWARDS</div>
                <div class="text-xl font-bold text-accent-yellow">
                  {userStake.isLoading ? '---' : formatSol(userStake.data?.stake?.totalRewardsReceived || '0')} SOL
                </div>
                <div class="text-sm text-text-dim">
                  ≈ ${formatUsd((parseFloat(userStake.data?.stake?.totalRewardsReceived || '0') / 1e9) * solPrice())}
                </div>
                <Show when={userStake.data?.stake && userStake.data.stake.stakeStartEpoch && stakingStats.data?.currentEpoch && userStake.data.stake.stakeStartEpoch >= stakingStats.data.currentEpoch}>
                  <div class="text-xs text-accent-yellow mt-2">
                    ⚠️ NOT ELIGIBLE FOR CURRENT EPOCH (STAKE FULL EPOCH TO EARN)
                  </div>
                </Show>
                <div class="text-xs text-accent-green mt-2">
                  🤖 AUTOMATIC DISTRIBUTION - Rewards sent directly to your wallet at epoch end
                </div>
              </div>
              
            </div>
          </div>
        </div>

        {/* Right Column - ACTIONS */}
        <div class="space-y-4">
          <div class="bg-bg-secondary border border-border">
            {/* Header row inside card */}
            <div class="flex justify-between items-center p-4 border-b border-border">
              <span class="text-xs text-text-dim uppercase tracking-wider">ACTIONS</span>
            </div>
            
            {/* Tabs */}
            <div class="flex border-b border-border">
              <button 
                onClick={() => setActiveTab('STAKE')}
                class={`flex-1 p-4 text-xs uppercase tracking-wider transition-colors ${
                  activeTab() === 'STAKE' 
                    ? 'text-text-primary border-b-2 border-accent-green' 
                    : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                STAKE
              </button>
              <button 
                onClick={() => setActiveTab('UNSTAKE')}
                class={`flex-1 p-4 text-xs uppercase tracking-wider transition-colors ${
                  activeTab() === 'UNSTAKE' 
                    ? 'text-text-primary border-b-2 border-accent-yellow' 
                    : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                UNSTAKE
              </button>
            </div>
            
            {/* Tab Content */}
            <div class="p-6">
              <Show when={activeTab() === 'STAKE'}>
                <div class="space-y-4">
                  <div class="relative">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={stakeAmount()}
                      onInput={(e) => setStakeAmount(e.target.value)}
                      class="w-full bg-bg-tertiary border border-border p-3 font-mono text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-green"
                    />
                    <div class="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-text-dim uppercase">
                      TOKENS
                    </div>
                  </div>
                  
                  <div class="text-xs text-text-secondary">
                    Available: {userTokenBalance.isLoading ? '---' : formatNumber(parseFloat(userTokenBalance.data || '0'))} TOKENS 
                    <button 
                      class="text-accent-blue hover:underline ml-2"
                      onClick={() => setStakeAmount(userTokenBalance.data || '0')}
                    >
                      [MAX]
                    </button>
                  </div>
                  
                  <div class="bg-bg-tertiary border border-border p-3 mb-4 text-xs text-text-secondary">
                    📋 <span class="text-accent-green">EPOCH RULES</span>: You must stake for a FULL epoch to earn rewards.
                    New stakes will be eligible starting from epoch #{(stakingStats.data?.currentEpoch || 0) + 1}.
                  </div>
                  
                  <Button
                    onClick={handleStake}
                    disabled={!canStake() || stakeMutation.isPending || stakingStats.data?.paused}
                    loading={stakeMutation.isPending}
                    class="w-full bg-accent-green text-bg-primary hover:bg-accent-green/90"
                  >
                    {stakingStats.data?.paused ? 'STAKING PAUSED' : stakeMutation.isPending ? 'STAKING...' : '[STAKE_TOKENS]'}
                  </Button>
                </div>
              </Show>
              
              <Show when={activeTab() === 'UNSTAKE'}>
                <div class="space-y-4">
                  <div class="relative">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={unstakeAmount()}
                      onInput={(e) => setUnstakeAmount(e.target.value)}
                      class="w-full bg-bg-tertiary border border-border p-3 font-mono text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-yellow"
                    />
                    <div class="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-text-dim uppercase">
                      TOKENS
                    </div>
                  </div>
                  
                  <div class="text-xs text-text-secondary">
                    Available: {formatNumber(parseFloat(userStake.data?.stake?.stakedAmount || '0') / 1e6)} TOKENS 
                    <button 
                      class="text-accent-blue hover:underline ml-2"
                      onClick={() => setUnstakeAmount((parseFloat(userStake.data?.stake?.stakedAmount || '0') / 1e6).toString())}
                    >
                      [MAX]
                    </button>
                  </div>
                  
                  <Button
                    onClick={handleUnstake}
                    disabled={!canUnstake() || unstakeMutation.isPending || stakingStats.data?.paused}
                    loading={unstakeMutation.isPending}
                    variant="outline"
                    class="w-full border-accent-yellow text-accent-yellow hover:bg-accent-yellow hover:text-bg-primary"
                  >
                    {stakingStats.data?.paused ? 'STAKING PAUSED' : unstakeMutation.isPending ? 'UNSTAKING...' : '[UNSTAKE_TOKENS]'}
                  </Button>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}