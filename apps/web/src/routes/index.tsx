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
    <div class="space-y-8">
      {/* Hero Section */}
      <div class="text-center py-12">
        <h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
          Borrow SOL Against Your 
          <span class="text-primary"> Memecoins</span>
        </h1>
        <p class="mt-6 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
          Unlock liquidity from your memecoin portfolio without selling. 
          Get instant SOL loans backed by your favorite tokens.
        </p>
        <div class="mt-10 flex items-center justify-center gap-x-6">
          <A href="/borrow">
            <Button size="lg">Start Borrowing</Button>
          </A>
          <A href="/loans">
            <Button variant="outline" size="lg">View Loans</Button>
          </A>
        </div>
      </div>
      
      {/* Protocol Stats */}
      <Show when={protocolStats.data}>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div class="bg-card p-6 rounded-lg border">
            <div class="text-2xl font-bold">
              {formatSOL(protocolStats.data?.totalValueLocked || '0')} SOL
            </div>
            <div class="text-sm text-muted-foreground">Total Value Locked</div>
          </div>
          <div class="bg-card p-6 rounded-lg border">
            <div class="text-2xl font-bold">
              {formatNumber(protocolStats.data?.totalLoansActive || 0)}
            </div>
            <div class="text-sm text-muted-foreground">Active Loans</div>
          </div>
          <div class="bg-card p-6 rounded-lg border">
            <div class="text-2xl font-bold">
              {formatSOL(protocolStats.data?.volume24h || '0')} SOL
            </div>
            <div class="text-sm text-muted-foreground">24h Volume</div>
          </div>
          <div class="bg-card p-6 rounded-lg border">
            <div class="text-2xl font-bold">
              {formatNumber(protocolStats.data?.liquidations24h || 0)}
            </div>
            <div class="text-sm text-muted-foreground">24h Liquidations</div>
          </div>
        </div>
      </Show>
      
      {/* Supported Tokens */}
      <div class="space-y-6">
        <h2 class="text-2xl font-bold">Supported Tokens</h2>
        <Show when={tokens.data}>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <For each={tokens.data}>
              {(token) => (
                <div class="bg-card p-6 rounded-lg border hover:border-primary/50 transition-colors">
                  <div class="flex items-center justify-between mb-4">
                    <div>
                      <div class="font-semibold">{token.symbol}</div>
                      <div class="text-sm text-muted-foreground">{token.name}</div>
                    </div>
                    <div class="text-right">
                      <div class="font-medium">${formatNumber(token.currentPrice)}</div>
                      <div class={`text-sm ${
                        token.priceChange24h >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {formatPercentage(token.priceChange24h)}
                      </div>
                    </div>
                  </div>
                  
                  <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Active Loans</span>
                      <span>{token.activeLoans}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Total Borrowed</span>
                      <span>{formatSOL(token.totalBorrowed)} SOL</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Available</span>
                      <span>{formatSOL(token.availableLiquidity)} SOL</span>
                    </div>
                  </div>
                  
                  <div class="mt-4">
                    <A href={`/borrow?token=${token.mint}`}>
                      <Button variant="outline" size="sm" class="w-full">
                        Borrow Against {token.symbol}
                      </Button>
                    </A>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      
      {/* How it Works */}
      <div class="space-y-6">
        <h2 class="text-2xl font-bold">How It Works</h2>
        <div class="grid md:grid-cols-3 gap-6">
          <div class="text-center">
            <div class="w-12 h-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center mx-auto mb-4">
              1
            </div>
            <h3 class="font-semibold mb-2">Deposit Collateral</h3>
            <p class="text-sm text-muted-foreground">
              Choose your memecoin and deposit it as collateral
            </p>
          </div>
          <div class="text-center">
            <div class="w-12 h-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center mx-auto mb-4">
              2
            </div>
            <h3 class="font-semibold mb-2">Get SOL</h3>
            <p class="text-sm text-muted-foreground">
              Receive SOL instantly based on your collateral value
            </p>
          </div>
          <div class="text-center">
            <div class="w-12 h-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center mx-auto mb-4">
              3
            </div>
            <h3 class="font-semibold mb-2">Repay & Reclaim</h3>
            <p class="text-sm text-muted-foreground">
              Repay the loan anytime to get your collateral back
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}