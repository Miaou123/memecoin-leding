import { TokenVerificationResult, TokenTier } from '@memecoin-lending/types';
import { Show } from 'solid-js';

interface TokenVerificationBadgeProps {
  verification: TokenVerificationResult | null;
  isLoading?: boolean;
  showDetails?: boolean;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

const tierColors = {
  [TokenTier.Bronze]: 'text-accent-red',
  [TokenTier.Silver]: 'text-accent-blue', 
  [TokenTier.Gold]: 'text-accent-yellow',
};

function formatLiquidity(liquidity: number): string {
  if (liquidity >= 1000000) {
    return `$${(liquidity / 1000000).toFixed(1)}M`;
  } else if (liquidity >= 1000) {
    return `$${(liquidity / 1000).toFixed(1)}K`;
  } else {
    return `$${liquidity.toFixed(2)}`;
  }
}

function getLTVForTier(tier: TokenTier): string {
  switch (tier) {
    case TokenTier.Gold:
      return '70%';
    case TokenTier.Silver:
      return '60%';
    case TokenTier.Bronze:
      return '50%';
    default:
      return '50%';
  }
}

export function TokenVerificationBadgeSolid(props: TokenVerificationBadgeProps) {
  const sizeClass = () => {
    switch (props.size || 'md') {
      case 'sm': return 'text-xs p-2';
      case 'md': return 'text-sm p-3';
      case 'lg': return 'text-base p-4';
      default: return 'text-sm p-3';
    }
  };

  return (
    <Show
      when={!props.isLoading}
      fallback={
        <div class={`bg-bg-secondary border border-border ${sizeClass()} font-mono ${props.class || ''}`}>
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 bg-text-dim animate-pulse"></div>
            <div class="text-text-dim">VERIFYING_TOKEN...</div>
          </div>
        </div>
      }
    >
      <Show 
        when={props.verification}
        fallback={
          <div class={`bg-bg-secondary border border-border ${sizeClass()} font-mono text-text-dim ${props.class || ''}`}>
            <div class="flex items-center gap-2">
              <div class="text-accent-red">⚠</div>
              <div>TOKEN_STATUS_UNKNOWN</div>
            </div>
          </div>
        }
      >
        <Show
          when={props.verification!.isValid}
          fallback={
            <div class={`bg-bg-secondary border-2 border-accent-red ${sizeClass()} font-mono ${props.class || ''}`}>
              <div class="flex items-start gap-2">
                <div class="text-accent-red mt-0.5">✗</div>
                <div>
                  <div class="text-accent-red font-bold">TOKEN_INVALID</div>
                  <Show when={props.showDetails && props.verification!.reason}>
                    <div class="text-text-dim text-xs mt-1">
                      ERROR: {props.verification!.reason}
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          }
        >
          <div class={`bg-bg-secondary border-2 border-accent-green ${sizeClass()} font-mono ${props.class || ''}`}>
            <div class="flex items-start gap-2">
              <div class="text-accent-green mt-0.5">✓</div>
              
              <div class="flex-1 min-w-0">
                <div class="text-accent-green font-bold flex items-center gap-2 flex-wrap">
                  <span>
                    {props.verification!.isWhitelisted 
                      ? props.verification!.whitelistSource === 'manual' 
                        ? 'ADMIN_WHITELISTED' 
                        : 'PUMPFUN_VERIFIED'
                      : 'PUMPFUN_VERIFIED'
                    }
                  </span>
                  
                  <Show when={props.verification!.isWhitelisted && props.verification!.whitelistSource === 'manual'}>
                    <span class="px-2 py-0.5 bg-accent-purple text-bg-primary text-xs">ADMIN</span>
                  </Show>
                  
                  <Show when={props.verification!.tier}>
                    <span class={`px-2 py-0.5 border text-xs ${tierColors[props.verification!.tier!]} border-current`}>
                      {props.verification!.tier!.toUpperCase()}_TIER
                    </span>
                  </Show>
                </div>
                
                <Show when={props.showDetails}>
                  <div class="text-text-secondary text-xs mt-2 space-y-1">
                    <Show when={props.verification!.isWhitelisted && props.verification!.whitelistSource === 'manual' && props.verification!.whitelistReason}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">REASON:</span>
                        <span>{props.verification!.whitelistReason}</span>
                      </div>
                    </Show>
                    
                    <Show when={props.verification!.liquidity > 0}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">LIQUIDITY:</span>
                        <span>{formatLiquidity(props.verification!.liquidity)}</span>
                      </div>
                    </Show>
                    
                    <Show when={props.verification!.tier}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">MAX_LTV:</span>
                        <span>{getLTVForTier(props.verification!.tier!)}</span>
                      </div>
                    </Show>
                    
                    <Show when={props.verification!.symbol}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">SYMBOL:</span>
                        <span>{props.verification!.symbol}</span>
                      </div>
                    </Show>
                    
                    <Show when={props.verification!.dexId}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">DEX_ID:</span>
                        <span>{props.verification!.dexId!.toUpperCase()}</span>
                      </div>
                    </Show>
                    
                    <div class="flex justify-between">
                      <span class="text-text-dim">SOURCE:</span>
                      <span>
                        {props.verification!.isWhitelisted 
                          ? props.verification!.whitelistSource === 'manual' ? 'ADMIN_WHITELIST' : 'PUMPFUN_AUTO'
                          : 'PUMPFUN'
                        }
                      </span>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

export default TokenVerificationBadgeSolid;