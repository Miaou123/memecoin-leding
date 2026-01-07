import { Show, For, createEffect, createSignal, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Button } from '@/components/ui/Button';
import { LoanCard } from '@/components/loans/LoanCard';
import { formatSOL } from '@/lib/utils';
import { api } from '@/lib/api';
import { LoanStatus } from '@memecoin-lending/types';

export default function Loans() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = createSignal<'active' | 'history'>('active');
  
  const userLoans = createQuery(() => ({
    queryKey: ['user-loans', wallet.publicKey()?.toString()],
    queryFn: () => {
      const walletAddress = wallet.publicKey()?.toString();
      if (!walletAddress) throw new Error('Wallet not connected');
      return api.getUserLoans(walletAddress);
    },
    enabled: () => wallet.connected(),
  }));
  
  const userStats = createQuery(() => ({
    queryKey: ['user-stats', wallet.publicKey()?.toString()],
    queryFn: () => {
      const walletAddress = wallet.publicKey()?.toString();
      if (!walletAddress) throw new Error('Wallet not connected');
      return api.getUserStats(walletAddress);
    },
    enabled: () => wallet.connected(),
  }));
  
  // Filter loans by status
  const activeLoans = createMemo(() => {
    if (!userLoans.data) return [];
    return userLoans.data.filter(loan => loan.status === LoanStatus.Active);
  });
  
  const historyLoans = createMemo(() => {
    if (!userLoans.data) return [];
    return userLoans.data.filter(loan => 
      loan.status === LoanStatus.Repaid || 
      loan.status === LoanStatus.LiquidatedTime || 
      loan.status === LoanStatus.LiquidatedPrice
    );
  });
  
  // Auto-refresh every 30 seconds
  createEffect(() => {
    const interval = setInterval(() => {
      if (wallet.connected()) {
        userLoans.refetch();
        userStats.refetch();
      }
    }, 30000);
    
    return () => clearInterval(interval);
  });
  
  const handleRepay = (loanId: string) => {
    navigate(`/repay/${loanId}`);
  };
  
  const handleView = (loanId: string) => {
    const network = import.meta.env.VITE_SOLANA_NETWORK || 'mainnet-beta';
    const clusterParam = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
    window.open(
      `https://explorer.solana.com/address/${loanId}${clusterParam}`,
      '_blank'
    );
  };
  
  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-3xl font-bold text-text-primary">[MY_LOANS]</h1>
        <Button onClick={() => navigate('/borrow')}>
          [CREATE_LOAN]
        </Button>
      </div>
      
      <Show when={!wallet.connected()}>
        <div class="text-center py-12 bg-bg-secondary border border-border">
          <div class="text-xl font-bold text-text-primary mb-4">[WALLET_NOT_CONNECTED]</div>
          <p class="text-text-dim mb-6">
            Please connect your wallet to view your loans
          </p>
          <Button onClick={wallet.connect}>
            [CONNECT_WALLET]
          </Button>
        </div>
      </Show>
      
      <Show when={wallet.connected()}>
        {/* Stats Bar */}
        <Show when={userStats.data}>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-2xl font-bold text-text-primary">
                {userStats.data!.activeLoans}
              </div>
              <div class="text-text-dim text-xs uppercase">Active Loans</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-2xl font-bold text-text-primary">
                {formatSOL(userStats.data!.totalBorrowed)}
              </div>
              <div class="text-text-dim text-xs uppercase">SOL Borrowed</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-2xl font-bold text-text-primary">
                {formatSOL(userStats.data!.totalRepaid)}
              </div>
              <div class="text-text-dim text-xs uppercase">SOL Repaid</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-2xl font-bold text-text-primary">
                {userStats.data!.liquidations}
              </div>
              <div class="text-text-dim text-xs uppercase">Liquidations</div>
            </div>
          </div>
        </Show>
        
        {/* Tabs */}
        <div class="border-b border-border">
          <div class="flex gap-1">
            <button 
              onClick={() => setActiveTab('active')}
              class={`px-6 py-3 text-xs uppercase tracking-wider border-b-2 transition ${
                activeTab() === 'active' 
                  ? 'border-accent-blue text-accent-blue' 
                  : 'border-transparent text-text-dim hover:text-text-primary'
              }`}
            >
              [ACTIVE] 
              <span class="ml-2 px-2 py-0.5 bg-accent-blue/20 text-xs">
                {activeLoans().length}
              </span>
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              class={`px-6 py-3 text-xs uppercase tracking-wider border-b-2 transition ${
                activeTab() === 'history' 
                  ? 'border-accent-blue text-accent-blue' 
                  : 'border-transparent text-text-dim hover:text-text-primary'
              }`}
            >
              [HISTORY] 
              <span class="ml-2 px-2 py-0.5 bg-accent-blue/20 text-xs">
                {historyLoans().length}
              </span>
            </button>
          </div>
        </div>
        
        {/* Tab Content */}
        <Show when={activeTab() === 'active'}>
          <Show 
            when={activeLoans().length > 0}
            fallback={
              <div class="text-center py-12 bg-bg-secondary border border-border">
                <div class="text-xl font-bold text-text-primary mb-4">[NO_ACTIVE_LOANS]</div>
                <p class="text-text-dim mb-6">
                  No active loans. Create your first loan to get started.
                </p>
                <Button onClick={() => navigate('/borrow')}>
                  [CREATE_LOAN]
                </Button>
              </div>
            }
          >
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <For each={activeLoans()}>
                {(loan) => (
                  <LoanCard 
                    loan={loan} 
                    onRepay={() => handleRepay(loan.pubkey)}
                    onView={() => handleView(loan.pubkey)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
        
        <Show when={activeTab() === 'history'}>
          <Show 
            when={historyLoans().length > 0}
            fallback={
              <div class="text-center py-12 bg-bg-secondary border border-border">
                <div class="text-xl font-bold text-text-primary mb-4">[NO_LOAN_HISTORY]</div>
                <p class="text-text-dim">
                  No loan history yet.
                </p>
              </div>
            }
          >
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <For each={historyLoans()}>
                {(loan) => (
                  <LoanCard 
                    loan={loan} 
                    onView={() => handleView(loan.pubkey)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
        
        {/* Loading States */}
        <Show when={userLoans.isLoading}>
          <div class="text-center py-8">
            <div class="text-text-primary mb-4">[LOADING...]</div>
            <p class="text-text-dim">Loading your loans...</p>
          </div>
        </Show>
        
        <Show when={userLoans.error}>
          <div class="text-center py-8 bg-bg-secondary border border-accent-red">
            <div class="text-accent-red mb-2">[ERROR_LOADING_LOANS]</div>
            <p class="text-text-dim mb-4">
              {userLoans.error?.message}
            </p>
            <Button onClick={() => userLoans.refetch()}>
              [TRY_AGAIN]
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  );
}