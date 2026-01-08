import { Show, createSignal, createMemo } from 'solid-js';
import { TokenVerificationResult, TokenTier } from '@memecoin-lending/types';
import { createTokenVerification } from '../../hooks/useTokenVerificationSolid';
import TokenRejectionDisplay from './TokenRejectionDisplay';

interface TokenInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  showVerification?: boolean;
  onVerificationChange?: (isValid: boolean | null) => void;
  class?: string;
  inputClass?: string;
  error?: string;
}

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
      return '50%';
    case TokenTier.Silver:
      return '35%';
    case TokenTier.Bronze:
      return '25%';
    default:
      return '25%';
  }
}

function getDexDisplayName(dexId?: string): string {
  switch (dexId?.toLowerCase()) {
    case 'raydium': return 'Raydium';
    case 'pumpswap': return 'PumpSwap';
    case 'pumpfun': return 'PumpFun';
    case 'orca': return 'Orca';
    default: return 'Verified';
  }
}

export function TokenInputSolid(props: TokenInputProps) {
  const [isFocused, setIsFocused] = createSignal(false);
  
  const verification = createTokenVerification(() => props.value);

  // Notify parent of verification status changes
  const isValid = verification.isValid();
  if (props.onVerificationChange && isValid !== null) {
    props.onVerificationChange(isValid);
  }

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newValue = target.value.trim();
    props.onChange(newValue);
  };

  const handleClear = () => {
    props.onChange('');
  };

  const hasError = createMemo(() => props.error || verification.error());
  const showValidation = createMemo(() => props.value && !verification.isLoading());
  const isValidAddress = createMemo(() => {
    const value = props.value;
    return value.length >= 32 && value.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
  });

  const getTierColors = (tier: TokenTier) => {
    switch (tier) {
      case TokenTier.Bronze:
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          text: 'text-yellow-800',
          badge: 'bg-yellow-100',
        };
      case TokenTier.Silver:
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          text: 'text-blue-800',
          badge: 'bg-blue-100',
        };
      case TokenTier.Gold:
        return {
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          text: 'text-amber-800',
          badge: 'bg-amber-100',
        };
      default:
        return {
          bg: 'bg-green-50',
          border: 'border-green-200',
          text: 'text-green-800',
          badge: 'bg-green-100',
        };
    }
  };

  return (
    <div class={`space-y-2 ${props.class || ''}`}>
      {/* Label */}
      <Show when={props.label}>
        <label class="block text-sm font-medium text-gray-700">
          {props.label}
          <Show when={props.required}>
            <span class="text-red-500 ml-1">*</span>
          </Show>
        </label>
      </Show>

      {/* Input Container */}
      <div class="relative">
        <input
          type="text"
          value={props.value}
          onInput={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={props.disabled}
          placeholder={props.placeholder || 'Enter token mint address...'}
          class={`
            w-full px-4 py-3 border rounded-lg font-mono text-sm
            transition-all duration-200 ease-in-out
            ${hasError() 
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
              : verification.isValid() && showValidation() 
                ? 'border-green-300 focus:border-green-500 focus:ring-green-500'
                : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
            }
            ${props.disabled ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}
            focus:outline-none focus:ring-2 focus:ring-opacity-50
            ${props.inputClass || ''}
          `}
          style={{ 'padding-right': props.value ? '2.5rem' : '1rem' }}
        />

        {/* Loading Spinner */}
        <Show when={verification.isLoading()}>
          <div class="absolute right-3 top-1/2 transform -translate-y-1/2">
            <svg class="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        </Show>

        {/* Clear Button */}
        <Show when={props.value && !verification.isLoading() && !props.disabled}>
          <button
            onClick={handleClear}
            class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            type="button"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </Show>

        {/* Validation Icon */}
        <Show when={showValidation() && !verification.isLoading()}>
          <div class="absolute right-3 top-1/2 transform -translate-y-1/2">
            <Show when={verification.isValid()}>
              <svg class="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Show>
            <Show when={!verification.isValid() && isValidAddress()}>
              <svg class="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </Show>
            <Show when={!verification.isValid() && !isValidAddress()}>
              <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Show>
          </div>
        </Show>
      </div>

      {/* Format Helper */}
      <Show when={isFocused() && !props.value}>
        <p class="text-xs text-gray-500">
          Expected format: base58 encoded address (32-44 characters)
        </p>
      </Show>

      {/* Error Message */}
      <Show when={hasError()}>
        <div class="flex items-start space-x-2 text-sm text-red-600">
          <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span>{hasError()}</span>
        </div>
      </Show>

      {/* Token Verification Badge */}
      <Show when={props.showVerification !== false && props.value && !hasError()}>
        <div class="mt-3">
          <Show when={verification.isLoading()}>
            <div class="inline-flex items-center space-x-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg animate-pulse">
              <div class="w-4 h-4 bg-gray-300 rounded"></div>
              <div class="flex-1">
                <div class="h-3 bg-gray-300 rounded w-20"></div>
                <div class="h-2 bg-gray-300 rounded w-16 mt-1"></div>
              </div>
            </div>
          </Show>

          <Show when={!verification.isLoading() && verification.data()}>
            {(data) => {
              const verificationData = data();
              if (!verificationData) return null;

              if (!verificationData.isValid) {
                return (
                  <TokenRejectionDisplay 
                    verification={verificationData}
                    class="animate-fadeIn"
                  />
                );
              }

              // Valid token
              const tierColors = verificationData.tier ? getTierColors(verificationData.tier) : getTierColors(TokenTier.Bronze);

              return (
                <div class={`inline-flex items-start space-x-2 px-3 py-2 ${tierColors.bg} border ${tierColors.border} rounded-lg text-sm`}>
                  <svg class={`w-4 h-4 text-green-600 flex-shrink-0 mt-0.5`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  
                  <div class="flex-1 min-w-0">
                    <div class={`${tierColors.text} font-medium flex items-center gap-2 flex-wrap`}>
                      <span>
                        {verificationData.isWhitelisted 
                          ? verificationData.whitelistSource === 'manual' 
                            ? 'Manually Whitelisted' 
                            : `Valid ${getDexDisplayName(verificationData.dexId)} Token`
                          : `Valid ${getDexDisplayName(verificationData.dexId)} Token`
                        }
                      </span>
                      
                      <Show when={verificationData.isWhitelisted && verificationData.whitelistSource === 'manual'}>
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 uppercase tracking-wide">
                          ADMIN
                        </span>
                      </Show>
                      
                      <Show when={verificationData.tier}>
                        <span class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierColors.badge} ${tierColors.text} uppercase tracking-wide`}>
                          {verificationData.tier}
                        </span>
                      </Show>
                    </div>
                    
                    <div class={`${tierColors.text} text-xs mt-1 space-y-0.5`}>
                      <Show when={verificationData.isWhitelisted && verificationData.whitelistSource === 'manual' && verificationData.whitelistReason}>
                        <div class="flex items-center justify-between">
                          <span class="text-gray-600">Reason:</span>
                          <span class="font-medium">{verificationData.whitelistReason}</span>
                        </div>
                      </Show>
                      
                      <Show when={verificationData.liquidity > 0}>
                        <div class="flex items-center justify-between">
                          <span class="text-gray-600">Liquidity:</span>
                          <span class="font-medium">{formatLiquidity(verificationData.liquidity)}</span>
                        </div>
                      </Show>
                      
                      <Show when={verificationData.tier}>
                        <div class="flex items-center justify-between">
                          <span class="text-gray-600">Max LTV:</span>
                          <span class="font-medium">{getLTVForTier(verificationData.tier!)}</span>
                        </div>
                      </Show>
                      
                      <Show when={verificationData.symbol}>
                        <div class="flex items-center justify-between">
                          <span class="text-gray-600">Symbol:</span>
                          <span class="font-medium font-mono">{verificationData.symbol}</span>
                        </div>
                      </Show>
                      
                      <Show when={verificationData.dexId}>
                        <div class="flex items-center justify-between">
                          <span class="text-gray-600">DEX:</span>
                          <span class="font-medium capitalize">{verificationData.dexId}</span>
                        </div>
                      </Show>
                      
                      <div class="flex items-center justify-between">
                        <span class="text-gray-600">Source:</span>
                        <span class="font-medium capitalize">
                          {verificationData.isWhitelisted 
                            ? verificationData.whitelistSource === 'manual' ? 'Admin Whitelist' : `${getDexDisplayName(verificationData.dexId)} Auto`
                            : getDexDisplayName(verificationData.dexId)
                          }
                        </span>
                      </div>
                    </div>
                    
                    {/* Pool Balance (for valid tokens) */}
                    <Show when={verificationData.poolBalance?.isBalanced}>
                      <div class="mt-3 pt-3 border-t border-gray-200">
                        <div class="flex items-center justify-between text-xs text-gray-500">
                          <span>Pool Balance:</span>
                          <span class="font-mono">
                            {verificationData.poolBalance!.baseTokenPercent.toFixed(1)}% Token / 
                            {verificationData.poolBalance!.quoteTokenPercent.toFixed(1)}% {verificationData.poolBalance!.quoteToken}
                          </span>
                        </div>
                        <div class="mt-1 h-2 rounded-full overflow-hidden flex bg-gray-200">
                          <div 
                            class="bg-blue-400"
                            style={{ width: `${verificationData.poolBalance!.baseTokenPercent}%` }}
                          />
                          <div 
                            class="bg-green-400"
                            style={{ width: `${verificationData.poolBalance!.quoteTokenPercent}%` }}
                          />
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </Show>
        </div>
      </Show>

      {/* Token Info */}
      <Show when={verification.data()?.isValid && verification.data()?.name}>
        {(data) => {
          const verificationData = data();
          if (!verificationData) return null;

          return (
            <div class="mt-2 p-3 bg-gray-50 rounded-lg">
              <div class="flex items-center space-x-3">
                {/* Token Logo Placeholder */}
                <div class="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  {verificationData.symbol?.charAt(0) || 'T'}
                </div>
                
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-900 truncate">
                    {verificationData.name}
                  </p>
                  <p class="text-xs text-gray-500 uppercase tracking-wide">
                    {verificationData.symbol}
                  </p>
                </div>
                
                <Show when={verificationData.tier}>
                  <span class={`
                    inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                    ${verificationData.tier === 'gold' ? 'bg-amber-100 text-amber-800' :
                      verificationData.tier === 'silver' ? 'bg-blue-100 text-blue-800' :
                      'bg-yellow-100 text-yellow-800'}
                  `}>
                    {verificationData.tier!.toUpperCase()}
                  </span>
                </Show>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}

export default TokenInputSolid;