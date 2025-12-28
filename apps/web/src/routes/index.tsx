import { Show, For, createResource } from 'solid-js';
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
  
  return (
    <div class="space-y-8 font-mono">
      {/* Terminal Header */}
      <div class="bg-bg-secondary border border-border p-6">
        <div class="text-xs text-text-dim mb-2">TERMINAL_PRO v1.0.0</div>
        <div class="text-xl font-bold text-accent-green mb-4">
          > MEMECOIN_LENDING_PROTOCOL.init()
        </div>
        <div class="text-text-primary mb-4">
          DEPLOY_MEMECOIN_COLLATERAL > RECEIVE_SOL_LIQUIDITY<br/>
          RISK_MANAGED_LENDING > PRICE_ORACLE_SECURED
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
      <Show when={protocolStats.data}>
        <div class="space-y-4">
          <div class="text-xs text-text-dim">PROTOCOL_METRICS_REAL_TIME:</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">TVL_LOCKED</div>
              <div class="text-lg font-bold text-accent-green">
                {formatSOL(protocolStats.data?.totalValueLocked || '0')}
              </div>
              <div class="text-xs text-text-secondary">SOL</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">ACTIVE_LOANS</div>
              <div class="text-lg font-bold text-text-primary">
                {formatNumber(protocolStats.data?.totalLoansActive || 0)}
              </div>
              <div class="text-xs text-text-secondary">COUNT</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">VOL_24H</div>
              <div class="text-lg font-bold text-accent-blue">
                {formatSOL(protocolStats.data?.volume24h || '0')}
              </div>
              <div class="text-xs text-text-secondary">SOL</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">LIQ_24H</div>
              <div class="text-lg font-bold text-accent-red">
                {formatNumber(protocolStats.data?.liquidations24h || 0)}
              </div>
              <div class="text-xs text-text-secondary">COUNT</div>
            </div>
          </div>
        </div>
      </Show>
      
      {/* Supported Tokens */}
      <div class="space-y-4">
        <div class="text-xs text-text-dim">SUPPORTED_COLLATERAL_TOKENS:</div>
        <Show when={tokens.data}>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <For each={tokens.data}>
              {(token) => (
                <div class="bg-bg-secondary border border-border p-4 hover:border-accent-green transition-colors">
                  <div class="flex items-center justify-between mb-3 border-b border-border pb-2">
                    <div>
                      <div class="text-sm font-bold text-text-primary">{token.symbol}</div>
                      <div class="text-xs text-text-dim">{token.name}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-sm font-bold text-accent-yellow">${formatNumber(token.currentPrice)}</div>
                      <div class={`text-xs ${
                        token.priceChange24h >= 0 ? 'text-accent-green' : 'text-accent-red'
                      }`}>
                        {token.priceChange24h >= 0 ? '+' : ''}{formatPercentage(token.priceChange24h)}%
                      </div>
                    </div>
                  </div>
                  
                  <div class="space-y-2 text-xs mb-3">
                    <div class="flex justify-between">
                      <span class="text-text-dim">ACTIVE_LOANS:</span>
                      <span class="text-text-primary">{token.activeLoans}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-text-dim">BORROWED_SOL:</span>
                      <span class="text-text-primary">{formatSOL(token.totalBorrowed)}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-text-dim">AVAILABLE_LIQ:</span>
                      <span class="text-accent-green">{formatSOL(token.availableLiquidity)}</span>
                    </div>
                  </div>
                  
                  <A href={`/borrow?token=${token.mint}`}>
                    <Button variant="outline" size="sm" class="w-full">
                      [BORROW_{token.symbol}]
                    </Button>
                  </A>
                </div>
              )}
            </For>
          </div>
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
              TRANSFER_TOKEN > LOCK_IN_VAULT > VERIFY_VALUE
            </div>
          </div>
          <div class="bg-bg-secondary border border-border p-4 text-center">
            <div class="w-8 h-8 bg-accent-blue text-bg-primary flex items-center justify-center mx-auto mb-3 text-xs font-bold">
              02
            </div>
            <div class="text-sm font-bold text-text-primary mb-2">RECEIVE_SOL</div>
            <div class="text-xs text-text-secondary">
              CALCULATE_LTV > MINT_LOAN > TRANSFER_SOL
            </div>
          </div>
          <div class="bg-bg-secondary border border-border p-4 text-center">
            <div class="w-8 h-8 bg-accent-yellow text-bg-primary flex items-center justify-center mx-auto mb-3 text-xs font-bold">
              03
            </div>
            <div class="text-sm font-bold text-text-primary mb-2">REPAY_UNLOCK</div>
            <div class="text-xs text-text-secondary">
              REPAY_SOL+INTEREST > BURN_LOAN > UNLOCK_COLLATERAL
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}