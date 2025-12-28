import { For, Show, createSignal } from 'solid-js';
import { TokenStats } from '@memecoin-lending/types';
import { formatNumber } from '@/lib/utils';

interface TokenSelectorProps {
  value?: string;
  onChange: (value: string) => void;
  tokens?: TokenStats[];
}

export function TokenSelector(props: TokenSelectorProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  
  const selectedToken = () => {
    return props.tokens?.find(t => t.mint === props.value);
  };
  
  const handleSelect = (mint: string) => {
    props.onChange(mint);
    setIsOpen(false);
  };
  
  return (
    <div class="relative">
      <button
        onClick={() => setIsOpen(!isOpen())}
        class="w-full p-3 border rounded-lg flex items-center justify-between hover:border-primary focus:ring-2 focus:ring-primary focus:border-transparent"
      >
        <Show 
          when={selectedToken()}
          fallback={<span class="text-muted-foreground">Select a token</span>}
        >
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
              <span class="text-xs font-medium">
                {selectedToken()?.symbol.charAt(0)}
              </span>
            </div>
            <div class="text-left">
              <div class="font-medium">{selectedToken()?.symbol}</div>
              <div class="text-sm text-muted-foreground">
                ${formatNumber(selectedToken()?.currentPrice || '0')}
              </div>
            </div>
          </div>
        </Show>
        
        <svg
          class={`w-4 h-4 transition-transform ${isOpen() ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      <Show when={isOpen()}>
        <div class="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          <For 
            each={props.tokens}
            fallback={
              <div class="p-3 text-center text-muted-foreground">
                No tokens available
              </div>
            }
          >
            {(token) => (
              <button
                onClick={() => handleSelect(token.mint)}
                class="w-full p-3 flex items-center space-x-3 hover:bg-accent text-left"
              >
                <div class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <span class="text-xs font-medium">
                    {token.symbol.charAt(0)}
                  </span>
                </div>
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <div class="font-medium">{token.symbol}</div>
                    <div class="text-sm">${formatNumber(token.currentPrice)}</div>
                  </div>
                  <div class="text-sm text-muted-foreground">
                    {token.name}
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}