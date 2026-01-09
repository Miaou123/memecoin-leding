import { Component, createSignal, createEffect, Show, For } from 'solid-js';
import { WalletToken } from '@/hooks/useWalletPumpTokens';
import { api } from '@/lib/api';
import { formatSOL, formatNumber, formatTokenAmount, shortenAddress } from '@/lib/utils';
import { getProtocolTokenMint } from '@/config/tokens';

interface TokenWithPrice extends WalletToken {
  price?: string;
  usdValue?: number;
}

interface TokenSelectionUnifiedProps {
  walletTokens: WalletToken[];
  isLoadingWalletTokens: boolean;
  onSelect: (mint: string) => void;
  selectedMint?: string;
  manualValue: string;
  onManualChange: (value: string) => void;
  walletConnected: boolean;
}

export const TokenSelectionUnified: Component<TokenSelectionUnifiedProps> = (props) => {
  const [tokensWithPrices, setTokensWithPrices] = createSignal<TokenWithPrice[]>([]);
  const [isLoadingPrices, setIsLoadingPrices] = createSignal(false);
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);
  const [inputFocused, setInputFocused] = createSignal(false);

  // Helper function to validate mint addresses
  const isValidMintAddress = (value: string): boolean => {
    const trimmed = value.trim();
    // Solana addresses are typically 32-44 characters, Base58 encoded
    const isValidLength = trimmed.length >= 32 && trimmed.length <= 44;
    const isValidBase58 = /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
    const isValid = isValidLength && isValidBase58;
    
    console.log('[TokenSelection] Validation:', { 
      value: trimmed.slice(0, 8) + '...', 
      length: trimmed.length, 
      isValidBase58, 
      isValid 
    });
    
    return isValid;
  };

  // Fetch prices when tokens change
  createEffect(async () => {
    const tokens = props.walletTokens;
    if (tokens.length === 0) {
      setTokensWithPrices([]);
      return;
    }

    setIsLoadingPrices(true);
    try {
      const protocolTokenMint = getProtocolTokenMint();
      
      // Only include protocol token if it's configured
      const tokensToProcess = [...tokens];
      if (protocolTokenMint && !tokens.some(t => t.mint === protocolTokenMint)) {
        tokensToProcess.unshift({
          mint: protocolTokenMint,
          balance: '0',
          uiBalance: '0',
          decimals: 6,
        });
      }
      
      // Get all unique mints
      const mints = tokensToProcess.map(t => t.mint);
      const pricesResponse = await api.getBatchPrices(mints);
      
      // The API returns the prices nested in the response
      const prices = pricesResponse;

      // Combine tokens with prices and calculate USD values
      const enrichedTokens: TokenWithPrice[] = tokensToProcess.map(token => {
        const priceData = prices[token.mint];
        // Handle both price formats - direct price string or object with usdPrice
        const price = priceData?.usdPrice || priceData?.price || '0';
        const usdValue = price && token.uiBalance 
          ? parseFloat(token.uiBalance) * parseFloat(price)
          : 0;

        // Debug logging for USD calculation (remove when not debugging)
        // console.log('USD calc:', {
        //   mint: token.mint.slice(0, 8) + '...',
        //   uiBalance: token.uiBalance,
        //   priceData: priceData,
        //   extractedPrice: price,
        //   calculated: usdValue
        // });

        return {
          ...token,
          price,
          usdValue,
        };
      });

      // Sort by USD value (highest first), but always prioritize the protocol token
      enrichedTokens.sort((a, b) => {
        // Show protocol token first if it exists
        if (protocolTokenMint) {
          if (a.mint === protocolTokenMint) return -1;
          if (b.mint === protocolTokenMint) return 1;
        }
        // Then sort by USD value
        return (b.usdValue || 0) - (a.usdValue || 0);
      });
      setTokensWithPrices(enrichedTokens);
    } catch (error) {
      console.error('Error fetching token prices:', error);
      // Still show tokens without prices, including protocol token
      const tokensToShow = [...tokens];
      const protocolTokenMint = getProtocolTokenMint();
      if (protocolTokenMint && !tokens.some(t => t.mint === protocolTokenMint)) {
        tokensToShow.unshift({
          mint: protocolTokenMint,
          balance: '0',
          uiBalance: '0',
          decimals: 6,
        });
      }
      setTokensWithPrices(tokensToShow);
    } finally {
      setIsLoadingPrices(false);
    }
  });

  const formatUsdValue = (value?: number) => {
    if (!value || value === 0) return '$0.00';
    if (value < 0.01) return '<$0.01';
    return `$${value.toFixed(2)}`;
  };

  const handleTokenSelect = (mint: string) => {
    props.onSelect(mint);
    props.onManualChange(mint);
    setIsDropdownOpen(false);
  };

  const handleInputChange = (value: string) => {
    console.log('[TokenSelection] Input change:', value.slice(0, 8) + '...');
    props.onManualChange(value);
    setIsDropdownOpen(true);
    
    // Auto-select when valid mint address is entered/pasted
    const trimmedValue = value.trim();
    if (isValidMintAddress(trimmedValue)) {
      console.log('[TokenSelection] Auto-selecting valid address:', trimmedValue.slice(0, 8) + '...');
      props.onSelect(trimmedValue);
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData?.getData('text')?.trim() || '';
    console.log('[TokenSelection] Paste detected:', pastedText.slice(0, 8) + '...');
    props.onManualChange(pastedText);
    
    if (isValidMintAddress(pastedText)) {
      console.log('[TokenSelection] Auto-selecting pasted valid address:', pastedText.slice(0, 8) + '...');
      props.onSelect(pastedText);
      setIsDropdownOpen(false);
    }
  };

  const handleInputFocus = () => {
    setInputFocused(true);
    setIsDropdownOpen(true);
  };

  const handleInputBlur = () => {
    setInputFocused(false);
    // Delay closing to allow click events on dropdown items
    setTimeout(() => {
      if (!inputFocused()) {
        setIsDropdownOpen(false);
      }
    }, 200);
  };

  const getDisplayValue = () => {
    if (props.selectedMint && props.selectedMint === props.manualValue) {
      // Find the selected token in wallet tokens for display
      const selectedToken = tokensWithPrices().find(t => t.mint === props.selectedMint);
      if (selectedToken && selectedToken.uiBalance && parseFloat(selectedToken.uiBalance) > 0) {
        // Only show balance info for tokens the user actually holds
        return `${props.selectedMint} (${formatTokenAmount(selectedToken.uiBalance)} tokens)`;
      }
      // For manually entered tokens or tokens with 0 balance, show full address
      return props.selectedMint;
    }
    return props.manualValue;
  };

  return (
    <div class="space-y-2">
      <span class="text-sm font-medium">Collateral Token</span>
      
      {/* Dropdown Container */}
      <div class="relative">
        {/* Input Field */}
        <div class="relative">
          <input
            type="text"
            value={getDisplayValue()}
            onInput={(e) => handleInputChange(e.currentTarget.value)}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onPaste={handlePaste}
            placeholder="Enter token mint address..."
            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent pr-10"
          />
          <div class="absolute right-3 top-1/2 -translate-y-1/2">
            <svg 
              class={`w-4 h-4 transition-transform ${isDropdownOpen() ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Dropdown Menu */}
        <Show when={isDropdownOpen()}>
          <div class="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto">
            {/* Manual Entry Section */}
            <Show when={props.manualValue.trim() && props.manualValue !== props.selectedMint}>
              <button
                onClick={() => handleTokenSelect(props.manualValue.trim())}
                class="w-full p-3 text-left hover:bg-accent border-b border-border"
                onMouseDown={(e) => e.preventDefault()} // Prevent blur
              >
                <div class="flex items-center space-x-2">
                  <svg class="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <div>
                    <div class="text-sm font-medium">Use Manual Entry</div>
                    <div class="text-xs text-gray-500 font-mono">{shortenAddress(props.manualValue)}</div>
                  </div>
                </div>
              </button>
            </Show>

            {/* Wallet Tokens Section */}
            <Show when={props.walletConnected && tokensWithPrices().length > 0}>
              <div class="p-2 border-b border-border">
                <div class="text-xs font-medium text-muted-foreground mb-2">Your Whitelisted Tokens</div>
              </div>
              <For each={tokensWithPrices()}>
                {(token) => (
                  <button
                    onClick={() => handleTokenSelect(token.mint)}
                    class={`w-full p-3 text-left hover:bg-accent border-b border-border last:border-b-0 ${
                      props.selectedMint === token.mint ? 'bg-primary/10' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur
                  >
                    <div class="flex justify-between items-start">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-2">
                          <div class="font-mono text-sm text-muted-foreground">
                            {shortenAddress(token.mint)}
                          </div>
                          {props.selectedMint === token.mint && (
                            <div class="text-xs text-primary">✓</div>
                          )}
                        </div>
                        <div class="text-sm text-foreground">
                          {formatTokenAmount(token.uiBalance)} tokens
                        </div>
                      </div>
                      <div class="text-right ml-2">
                        <div class="text-sm font-semibold text-foreground">
                          {formatUsdValue(token.usdValue)}
                        </div>
                        {token.price && parseFloat(token.price) > 0 && (
                          <div class="text-xs text-muted-foreground">
                            ${parseFloat(token.price).toFixed(6)}/token
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </Show>

            {/* Loading State */}
            <Show when={props.walletConnected && (isLoadingPrices() || props.isLoadingWalletTokens)}>
              <div class="p-4 text-center text-muted-foreground">
                <div class="flex items-center justify-center space-x-2">
                  <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span class="text-sm">Loading tokens...</span>
                </div>
              </div>
            </Show>

            {/* Empty State */}
            <Show when={props.walletConnected && !isLoadingPrices() && !props.isLoadingWalletTokens && tokensWithPrices().length === 0 && !props.manualValue.trim()}>
              <div class="p-4 text-center text-muted-foreground">
                <div class="text-sm">No whitelisted tokens found in your wallet</div>
                <div class="text-xs mt-1">Enter a token address above to continue</div>
              </div>
            </Show>

            {/* Not Connected State */}
            <Show when={!props.walletConnected && !props.manualValue.trim()}>
              <div class="p-4 text-center text-muted-foreground">
                <div class="text-sm">Connect your wallet to see your tokens</div>
                <div class="text-xs mt-1">Or enter a token address above</div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      
      {/* Helper text */}
      <p class="text-xs text-muted-foreground">
        Enter a token address to check its eligibility
      </p>
    </div>
  );
};