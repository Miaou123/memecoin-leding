import { Show, For, createMemo } from 'solid-js';
import { A } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { Button } from '@/components/ui/Button';
import { formatSOL, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api';
import { RecentLoanItem } from '@/components/dashboard/RecentLoanItem';
import { ProtocolHealth } from '@/components/dashboard/ProtocolHealth';
import { RecentLoanResponse } from '@memecoin-lending/types';

export default function Home() {
  // Protocol stats
  const protocolStats = useQuery(() => ({
    queryKey: ['protocol-stats'],
    queryFn: () => api.getProtocolStats(),
  }));

  // Recent loans (all users, for dashboard feed)
  const recentLoans = useQuery(() => ({
    queryKey: ['recent-loans'],
    queryFn: () => api.getRecentLoans({ limit: 5 }),
  }));

  // Top collateral token
  const topToken = useQuery(() => ({
    queryKey: ['top-token'],
    queryFn: () => api.getTopCollateralToken(),
  }));

  // Calculate protocol health metrics
  const protocolHealth = createMemo(() => {
    if (!protocolStats.data) return null;
    
    const totalValueLocked = Number(protocolStats.data.totalValueLocked || 0);
    const totalBorrowed = Number(protocolStats.data.totalSolBorrowed || 0);
    const available = totalValueLocked - totalBorrowed;
    const utilization = totalValueLocked > 0 ? (totalBorrowed / totalValueLocked) * 100 : 0;
    
    return {
      available: available.toString(),
      borrowed: totalBorrowed.toString(),
      utilization
    };
  });
  
  return (
    <div class="max-w-4xl mx-auto space-y-4 font-mono">
      {/* Hero Section */}
      <div class="text-center py-8">
        <div class="text-2xl font-bold text-accent-green mb-2">
          {">"} MEMECOIN_LENDING
        </div>
        <div class="text-text-secondary mb-6">
          Borrow SOL instantly using memecoins as collateral
        </div>
        <div class="flex justify-center gap-4">
          <A href="/borrow">
            <Button size="lg">[START_BORROWING]</Button>
          </A>
          <A href="/loans">
            <Button variant="outline" size="lg">[VIEW_LOANS]</Button>
          </A>
        </div>
        
        {/* Protocol Token */}
        <div class="text-center mt-8">
          <div class="bg-bg-secondary border border-border p-3 mx-auto max-w-fit">
            <button 
              onClick={() => {
                const tokenMint = '6KHL8uUXFie8Xdy3EBvw6EgruiU3duc9fvGrWoZ9pump';
                navigator.clipboard.writeText(tokenMint);
              }}
              class="font-mono text-sm text-text-primary hover:text-accent-green transition-colors cursor-pointer"
              title="Click to copy"
            >
              6KHL8uUXFie8Xdy3EBvw6EgruiU3duc9fvGrWoZ9pump
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Stats Bar */}
      <div class="flex justify-center gap-8 py-4 border-y border-border">
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-blue">
            {protocolStats.isLoading ? '---' : formatSOL(protocolStats.data?.totalValueLocked || '0')} SOL
          </div>
          <div class="text-text-dim text-xs">TVL_LOCKED</div>
        </div>
        <div class="w-px bg-border"></div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-green">
            {protocolStats.isLoading ? '---' : formatNumber(protocolStats.data?.totalLoansActive || 0)}
          </div>
          <div class="text-text-dim text-xs">ACTIVE_LOANS</div>
        </div>
        <div class="w-px bg-border"></div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-text-primary">
            {protocolStats.isLoading ? '---' : formatNumber(protocolStats.data?.totalLoansCreated || 0)}
          </div>
          <div class="text-text-dim text-xs">TOTAL_LOANS</div>
        </div>
        <div class="w-px bg-border"></div>
        
        <div class="text-center">
          <div class="text-2xl font-bold text-accent-green">
            {protocolStats.isLoading ? '---' : formatSOL(protocolStats.data?.volume24h || '0')} SOL
          </div>
          <div class="text-text-dim text-xs">24H_VOLUME</div>
        </div>
      </div>

      {/* Two Column Grid */}
      <div class="grid grid-cols-2 gap-6">
        {/* Left Column: Recent Loans */}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="text-xs text-text-dim">RECENT_LOANS:</div>
            <A href="/loans" class="text-xs text-accent-green hover:text-accent-green/80">
              [VIEW_ALL]
            </A>
          </div>
          
          <div class="bg-bg-secondary border border-border">
            <Show 
              when={!recentLoans.isLoading && recentLoans.data && recentLoans.data.length > 0}
              fallback={
                <div class="p-6 text-center text-text-dim">
                  {recentLoans.isLoading ? 'LOADING...' : 'NO_RECENT_LOANS'}
                </div>
              }
            >
              <For each={recentLoans.data}>
                {(loan: RecentLoanResponse) => (
                  <RecentLoanItem 
                    loan={{
                      id: loan.id || 'unknown',
                      tokenSymbol: loan.tokenSymbol || 'UNKNOWN',
                      tokenName: loan.tokenName || 'Unknown Token',
                      amount: loan.solBorrowed?.toString() || '0',
                      status: loan.status === 'active' ? 'Active' : 
                              loan.healthScore && loan.healthScore < 50 ? 'AtRisk' : 'Active',
                      createdAt: loan.createdAt || Math.floor(Date.now() / 1000)
                    }}
                  />
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Right Column: Top Collateral + Protocol Health */}
        <div class="space-y-6">
          {/* Top Collateral Token */}
          <div class="space-y-4">
            <div class="text-xs text-text-dim">TOP_COLLATERAL:</div>
            <Show 
              when={!topToken.isLoading && topToken.data}
              fallback={
                <div class="bg-bg-secondary border border-border p-6 text-center text-text-dim">
                  {topToken.isLoading ? 'LOADING...' : 'NO_TOKEN_DATA'}
                </div>
              }
            >
              <div class="bg-bg-secondary border-2 border-accent-green p-6">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-3">
                    {/* Token Avatar */}
                    <div class="w-14 h-14 bg-accent-green/20 border border-accent-green flex items-center justify-center">
                      <span class="text-xl font-bold text-accent-green">
                        {topToken.data?.symbol?.slice(0, 2) || '??'}
                      </span>
                    </div>
                    
                    {/* Token Info */}
                    <div>
                      <div class="text-lg font-bold text-text-primary">
                        {topToken.data?.symbol || 'UNKNOWN'}
                      </div>
                      <div class="text-xs text-text-dim">
                        {topToken.data?.name || 'Unknown Token'}
                      </div>
                      <div class="text-xs text-text-secondary font-mono break-all">
                        {topToken.data?.mint}
                      </div>
                    </div>
                  </div>
                  
                  {/* Loan Count */}
                  <div class="text-right">
                    <div class="text-2xl font-bold text-accent-green">
                      {formatNumber(topToken.data?.totalLoans || 0)}
                    </div>
                    <div class="text-xs text-text-dim">LOANS</div>
                  </div>
                </div>
                
                <A href={`/borrow?token=${topToken.data?.mint}`}>
                  <Button class="w-full">
                    [BORROW_WITH_{topToken.data?.symbol}]
                  </Button>
                </A>
              </div>
            </Show>
          </div>

          {/* Protocol Health */}
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="text-xs text-text-dim">PROTOCOL_HEALTH:</div>
              <div class="text-xs text-accent-green">
                {protocolHealth() && protocolHealth()!.utilization < 50 ? '[HEALTHY]' : 
                 protocolHealth() && protocolHealth()!.utilization < 80 ? '[MODERATE]' : '[HIGH_UTIL]'}
              </div>
            </div>
            <Show 
              when={protocolHealth()}
              fallback={
                <div class="bg-bg-secondary border border-border p-6 text-center text-text-dim">
                  LOADING...
                </div>
              }
            >
              <ProtocolHealth 
                available={protocolHealth()!.available}
                borrowed={protocolHealth()!.borrowed}
                utilization={protocolHealth()!.utilization}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
