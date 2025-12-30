import { Component, createSignal, createEffect, Show, For } from 'solid-js';
import { WalletToken } from '@/hooks/useWalletPumpTokens';
import { api } from '@/lib/api';
import { formatSOL, shortenAddress } from '@/lib/utils';

interface TokenWithPrice extends WalletToken {
  price?: string;
  usdValue?: number;
}

interface WalletTokenListProps {
  tokens: WalletToken[];
  onSelect: (mint: string) => void;
  selectedMint?: string;
}

export const WalletTokenList: Component<WalletTokenListProps> = (props) => {
  const [tokensWithPrices, setTokensWithPrices] = createSignal<TokenWithPrice[]>([]);
  const [isLoadingPrices, setIsLoadingPrices] = createSignal(false);

  // Fetch prices when tokens change
  createEffect(async () => {
    const tokens = props.tokens;
    if (tokens.length === 0) {
      setTokensWithPrices([]);
      return;
    }

    setIsLoadingPrices(true);
    try {
      // Get all unique mints
      const mints = tokens.map(t => t.mint);
      const pricesResponse = await api.getBatchPrices(mints);
      
      // The API returns the prices nested in the response
      const prices = pricesResponse;

      // Combine tokens with prices and calculate USD values
      const enrichedTokens: TokenWithPrice[] = tokens.map(token => {
        const priceData = prices[token.mint];
        // Handle both price formats - direct price string or object with usdPrice
        const price = priceData?.usdPrice || priceData?.price || '0';
        const usdValue = price && token.uiBalance 
          ? parseFloat(token.uiBalance) * parseFloat(price)
          : 0;

        return {
          ...token,
          price,
          usdValue,
        };
      });

      // Sort by USD value (highest first)
      enrichedTokens.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
      setTokensWithPrices(enrichedTokens);
    } catch (error) {
      console.error('Error fetching token prices:', error);
      // Still show tokens without prices
      setTokensWithPrices(tokens);
    } finally {
      setIsLoadingPrices(false);
    }
  });

  const formatUsdValue = (value?: number) => {
    if (!value || value === 0) return '$0.00';
    if (value < 0.01) return '<$0.01';
    return `$${value.toFixed(2)}`;
  };

  return (
    <div class="space-y-2">
      <Show when={isLoadingPrices()}>
        <div class="text-center py-4 text-muted-foreground">
          Loading prices...
        </div>
      </Show>

      <Show when={!isLoadingPrices() && tokensWithPrices().length === 0}>
        <div class="text-center py-8 text-muted-foreground">
          <p>No PumpFun tokens found in your wallet</p>
          <p class="text-sm mt-2">PumpFun tokens have addresses ending in "pump"</p>
        </div>
      </Show>

      <Show when={!isLoadingPrices() && tokensWithPrices().length > 0}>
        <div class="grid gap-2">
          <For each={tokensWithPrices()}>
            {(token) => (
              <button
                onClick={() => props.onSelect(token.mint)}
                class={`
                  p-4 border rounded-lg bg-card hover:bg-accent transition-colors
                  text-left w-full
                  ${props.selectedMint === token.mint ? 'border-primary' : 'border-border'}
                `}
              >
                <div class="flex justify-between items-start">
                  <div class="flex-1">
                    <div class="font-mono text-sm text-muted-foreground">
                      {shortenAddress(token.mint)}
                    </div>
                    <div class="mt-1">
                      <span class="text-lg font-semibold">
                        {formatSOL(token.uiBalance)}
                      </span>
                      <span class="text-sm text-muted-foreground ml-2">
                        tokens
                      </span>
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="text-lg font-semibold">
                      {formatUsdValue(token.usdValue)}
                    </div>
                    {token.price && parseFloat(token.price) > 0 && (
                      <div class="text-sm text-muted-foreground">
                        ${parseFloat(token.price).toFixed(6)}/token
                      </div>
                    )}
                  </div>
                </div>
                {props.selectedMint === token.mint && (
                  <div class="mt-2 text-xs text-primary">
                    ✓ Selected
                  </div>
                )}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};