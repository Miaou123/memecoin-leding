import { Show, createMemo } from 'solid-js';
import { A } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { Button } from '@/components/ui/Button';
import { formatSOL, formatNumber, formatPercentage } from '@/lib/utils';
import { api } from '@/lib/api';

export default function Home() {
  const protocolStats = createQuery(() => ({
    queryKey: ['protocol-stats'],
    queryFn: () => api.getProtocolStats(),
  }));
  
  const tokens = createQuery(() => ({
    queryKey: ['tokens'],
    queryFn: () => api.getTokens(),
  }));

  // Find most used token by total loans or volume
  const topToken = createMemo(() => {
    if (!tokens.data || tokens.data.length === 0) return null;
    // Sort by total loans count (or you could use volume)
    return [...tokens.data].sort((a, b) => 
      (b.totalLoans || 0) - (a.totalLoans || 0)
    )[0];
  });
  
  return (
    <div class="space-y-8 font-mono">
      {/* Terminal Header */}
      <div class="bg-bg-secondary border border-border p-6">
        <div class="text-xs text-text-dim mb-2">TERMINAL_PRO v1.0.0</div>
        <div class="text-xl font-bold text-accent-green mb-4">
          {">"} MEMECOIN_LENDING_PROTOCOL.init()
        </div>
        <div class="text-text-primary mb-4">
          DEPLOY_MEMECOIN_COLLATERAL {">"} RECEIVE_SOL_LIQUIDITY<br/>
          RISK_MANAGED_LENDING {">"} PRICE_ORACLE_SECURED
        </div>
        <div class="flex gap-4">
          <A href="/borrow">
            <Button size="lg">[INITIATE_LOAN]</Button>
          </A>
          <A href="/loans">
            <Button variant="outline" size="lg">[VIEW_POSITIONS]</Button>
          </A>
        </div>
      </div>
      
      {/* Protocol Stats Grid */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">PROTOCOL_METRICS_REAL_TIME:</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">TREASURY_BALANCE</div>
            <div class="text-lg font-bold text-accent-green">
              {protocolStats.isLoading ? '---' : formatSOL(protocolStats.data?.treasuryBalance || '0')}
            </div>
            <div class="text-xs text-text-secondary">SOL</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">TVL_LOCKED</div>
            <div class="text-lg font-bold text-accent-blue">
              {protocolStats.isLoading ? '---' : formatSOL(protocolStats.data?.totalValueLocked || '0')}
            </div>
            <div class="text-xs text-text-secondary">SOL</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">ACTIVE_LOANS</div>
            <div class="text-lg font-bold text-accent-yellow">
              {protocolStats.isLoading ? '---' : formatNumber(protocolStats.data?.totalLoansActive || 0)}
            </div>
            <div class="text-xs text-text-secondary">COUNT</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">TOTAL_LOANS</div>
            <div class="text-lg font-bold text-text-primary">
              {protocolStats.isLoading ? '---' : formatNumber(protocolStats.data?.totalLoansIssued || 0)}
            </div>
            <div class="text-xs text-text-secondary">ALL_TIME</div>
          </div>
        </div>

        {/* Second Row - More Stats */}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">VOL_24H</div>
            <div class="text-lg font-bold text-accent-green">
              {protocolStats.isLoading ? '---' : formatSOL(protocolStats.data?.volume24h || '0')}
            </div>
            <div class="text-xs text-text-secondary">SOL</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">FEES_EARNED</div>
            <div class="text-lg font-bold text-accent-blue">
              {protocolStats.isLoading ? '---' : formatSOL(protocolStats.data?.totalFeesEarned || '0')}
            </div>
            <div class="text-xs text-text-secondary">SOL</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">LIQUIDATIONS</div>
            <div class="text-lg font-bold text-accent-red">
              {protocolStats.isLoading ? '---' : formatNumber(protocolStats.data?.totalLiquidations || 0)}
            </div>
            <div class="text-xs text-text-secondary">COUNT</div>
          </div>
          <div class="bg-bg-secondary border border-border p-4">
            <div class="text-xs text-text-dim mb-1">AVG_LTV</div>
            <div class="text-lg font-bold text-text-primary">
              {protocolStats.isLoading ? '---' : formatPercentage(protocolStats.data?.averageLtv || 0)}
            </div>
            <div class="text-xs text-text-secondary">RATIO</div>
          </div>
        </div>
      </div>

      {/* Top Collateral Token */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">TOP_COLLATERAL_TOKEN:</div>
        <Show 
          when={!tokens.isLoading && topToken()} 
          fallback={
            <div class="bg-bg-secondary border border-border p-6 text-center text-text-dim">
              {tokens.isLoading ? 'LOADING...' : 'NO_TOKEN_DATA'}
            </div>
          }
        >
          {(token) => (
            <div class="bg-bg-secondary border-2 border-accent-green p-6">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-4">
                  <div class="w-12 h-12 bg-accent-green/20 border border-accent-green flex items-center justify-center">
                    <span class="text-xl font-bold text-accent-green">
                      {topToken()?.symbol?.slice(0, 2) || '??'}
                    </span>
                  </div>
                  <div>
                    <div class="text-lg font-bold text-text-primary">{topToken()?.symbol || 'UNKNOWN'}</div>
                    <div class="text-xs text-text-dim">{topToken()?.name || 'Unknown Token'}</div>
                    <div class="text-xs text-text-secondary mt-1">
                      MINT: {topToken()?.mint?.slice(0, 8)}...{topToken()?.mint?.slice(-4)}
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="grid grid-cols-2 gap-6">
                    <div>
                      <div class="text-xs text-text-dim">TOTAL_LOANS</div>
                      <div class="text-lg font-bold text-accent-green">
                        {formatNumber(topToken()?.totalLoans || 0)}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs text-text-dim">LTV_RATIO</div>
                      <div class="text-lg font-bold text-accent-blue">
                        {formatPercentage(topToken()?.ltvRatio || 0.5)}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs text-text-dim">CURRENT_PRICE</div>
                      <div class="text-lg font-bold text-text-primary">
                        ${topToken()?.price?.toFixed(6) || '0.00'}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs text-text-dim">24H_CHANGE</div>
                      <div class={`text-lg font-bold ${(topToken()?.priceChange24h || 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {(topToken()?.priceChange24h || 0) >= 0 ? '+' : ''}{formatPercentage(topToken()?.priceChange24h || 0)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="mt-4 pt-4 border-t border-border flex gap-4">
                <A href={`/borrow?token=${topToken()?.mint}`} class="flex-1">
                  <Button size="lg" class="w-full">[BORROW_WITH_{topToken()?.symbol}]</Button>
                </A>
              </div>
            </div>
          )}
        </Show>
      </div>
      
      {/* Protocol Flow */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">PROTOCOL_EXECUTION_FLOW:</div>
        <div class="grid md:grid-cols-3 gap-4">
          <div class="bg-bg-secondary border border-border p-4 text-center">
            <div class="w-8 h-8 bg-accent-green text-bg-primary flex items-center justify-center mx-auto mb-3 text-xs font-bold">
              01
            </div>
            <div class="text-sm font-bold text-text-primary mb-2">DEPLOY_COLLATERAL</div>
            <div class="text-xs text-text-secondary">
              TRANSFER_TOKEN {">"} LOCK_IN_VAULT {">"} VERIFY_VALUE
            </div>
          </div>
          <div class="bg-bg-secondary border border-border p-4 text-center">
            <div class="w-8 h-8 bg-accent-blue text-bg-primary flex items-center justify-center mx-auto mb-3 text-xs font-bold">
              02
            </div>
            <div class="text-sm font-bold text-text-primary mb-2">RECEIVE_SOL</div>
            <div class="text-xs text-text-secondary">
              CALCULATE_LTV {">"} MINT_LOAN {">"} TRANSFER_SOL
            </div>
          </div>
          <div class="bg-bg-secondary border border-border p-4 text-center">
            <div class="w-8 h-8 bg-accent-yellow text-bg-primary flex items-center justify-center mx-auto mb-3 text-xs font-bold">
              03
            </div>
            <div class="text-sm font-bold text-text-primary mb-2">REPAY_UNLOCK</div>
            <div class="text-xs text-text-secondary">
              REPAY_SOL+INTEREST {">"} BURN_LOAN {">"} UNLOCK_COLLATERAL
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
