import { Show, For, createEffect } from 'solid-js';
import { A } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Button } from '@/components/ui/Button';
import { LoanCard } from '@/components/loans/LoanCard';
import { formatSOL, formatTimeRemaining } from '@/lib/utils';
import { api } from '@/lib/api';

export default function Loans() {
  const wallet = useWallet();
  
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
  
  return (
    <div class="space-y-8">
      <div class="flex items-center justify-between">
        <h1 class="text-3xl font-bold">My Loans</h1>
        <A href="/borrow">
          <Button>Create New Loan</Button>
        </A>
      </div>
      
      <Show when={!wallet.connected()}>
        <div class="text-center py-12">
          <h2 class="text-xl font-semibold mb-2">Wallet Not Connected</h2>
          <p class="text-muted-foreground mb-4">
            Please connect your wallet to view your loans
          </p>
          <Button onClick={wallet.connect}>Connect Wallet</Button>
        </div>
      </Show>
      
      <Show when={wallet.connected()}>
        {/* User Stats */}
        <Show when={userStats.data}>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-card p-4 rounded-lg border">
              <div class="text-lg font-semibold">
                {userStats.data!.activeLoans}
              </div>
              <div class="text-sm text-muted-foreground">Active Loans</div>
            </div>
            <div class="bg-card p-4 rounded-lg border">
              <div class="text-lg font-semibold">
                {formatSOL(userStats.data!.totalBorrowed)} SOL
              </div>
              <div class="text-sm text-muted-foreground">Total Borrowed</div>
            </div>
            <div class="bg-card p-4 rounded-lg border">
              <div class="text-lg font-semibold">
                {formatSOL(userStats.data!.totalRepaid)} SOL
              </div>
              <div class="text-sm text-muted-foreground">Total Repaid</div>
            </div>
            <div class="bg-card p-4 rounded-lg border">
              <div class="text-lg font-semibold">
                {userStats.data!.liquidations}
              </div>
              <div class="text-sm text-muted-foreground">Liquidations</div>
            </div>
          </div>
        </Show>
        
        {/* Loans List */}
        <div class="space-y-4">
          <Show 
            when={userLoans.data && userLoans.data.length > 0}
            fallback={
              <div class="text-center py-12">
                <h2 class="text-xl font-semibold mb-2">No Loans Found</h2>
                <p class="text-muted-foreground mb-4">
                  You haven't created any loans yet
                </p>
                <A href="/borrow">
                  <Button>Create Your First Loan</Button>
                </A>
              </div>
            }
          >
            <h2 class="text-xl font-semibold">Your Loans</h2>
            <div class="grid gap-4 md:grid-cols-2">
              <For each={userLoans.data}>
                {(loan) => <LoanCard loan={loan} />}
              </For>
            </div>
          </Show>
        </div>
        
        {/* Loading States */}
        <Show when={userLoans.isLoading}>
          <div class="text-center py-8">
            <div class="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p class="text-muted-foreground">Loading your loans...</p>
          </div>
        </Show>
        
        <Show when={userLoans.error}>
          <div class="text-center py-8">
            <div class="text-red-600 mb-2">Failed to load loans</div>
            <p class="text-muted-foreground mb-4">
              {userLoans.error?.message}
            </p>
            <Button onClick={() => userLoans.refetch()}>
              Try Again
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  );
}