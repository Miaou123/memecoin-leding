import { Show, createMemo, createSignal } from 'solid-js';
import { TokenVerificationResult, PoolBalanceInfo, TokenRejectionCode } from '@memecoin-lending/types';
import { useWallet } from '../../hooks/useWallet';
import { api } from '../../lib/api';

interface Props {
  verification: TokenVerificationResult;
  class?: string;
}

const REJECTION_INFO: Record<TokenRejectionCode, {
  title: string;
  icon: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}> = {
  INVALID_ADDRESS: {
    title: 'Invalid Address',
    icon: '❌',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
  },
  NOT_SUPPORTED_DEX: {
    title: 'Unsupported Token',
    icon: '🚫',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    textColor: 'text-orange-800',
  },
  POOL_IMBALANCED: {
    title: 'Pool Imbalanced',
    icon: '⚠️',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-800',
  },
  INSUFFICIENT_LIQUIDITY: {
    title: 'Low Liquidity',
    icon: '💧',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-800',
  },
  TOKEN_TOO_NEW: {
    title: 'Token Too New',
    icon: '⏰',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    textColor: 'text-orange-800',
  },
  TOKEN_DISABLED: {
    title: 'Token Disabled',
    icon: '🔒',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-800',
  },
  TOKEN_BLACKLISTED: {
    title: 'Token Blocked',
    icon: '⛔',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
  },
  WHITELIST_FAILED: {
    title: 'Verification Failed',
    icon: '🔄',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    textColor: 'text-purple-800',
  },
  PRICE_UNAVAILABLE: {
    title: 'Price Unavailable',
    icon: '📊',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    textColor: 'text-indigo-800',
  },
};

const DEFAULT_INFO = {
  title: 'Token Not Eligible',
  icon: '❌',
  bgColor: 'bg-red-50',
  borderColor: 'border-red-200',
  textColor: 'text-red-800',
};

export function TokenRejectionDisplay(props: Props) {
  const info = createMemo(() => {
    const code = props.verification.rejectionCode as TokenRejectionCode | undefined;
    return code && REJECTION_INFO[code] ? REJECTION_INFO[code] : DEFAULT_INFO;
  });
  
  const wallet = useWallet();
  const [requestLoading, setRequestLoading] = createSignal(false);
  const [requestStatus, setRequestStatus] = createSignal<'idle' | 'success' | 'error' | 'rate-limited' | 'already-requested'>('idle');
  const [requestError, setRequestError] = createSignal<string>('');
  const [reason, setReason] = createSignal('');
  
  const handleVerificationRequest = async () => {
    if (!wallet.publicKey() || !props.verification.tokenData?.mint) {
      return;
    }
    
    setRequestLoading(true);
    setRequestStatus('idle');
    setRequestError('');
    
    try {
      const response = await api.post('/api/verification-request', {
        mint: props.verification.tokenData.mint,
        reason: reason().trim() || undefined,
      });
      
      if (response.success) {
        setRequestStatus('success');
      } else if (response.alreadyRequested) {
        setRequestStatus('already-requested');
      } else if (response.error?.includes('wait')) {
        setRequestStatus('rate-limited');
        setRequestError(response.error);
      } else {
        setRequestStatus('error');
        setRequestError(response.error || 'Failed to submit request');
      }
    } catch (error) {
      console.error('Verification request error:', error);
      setRequestStatus('error');
      setRequestError('Network error. Please try again.');
    } finally {
      setRequestLoading(false);
    }
  };
  
  // Check if the token is eligible for manual verification request
  const canRequestVerification = createMemo(() => {
    return props.verification.rejectionCode === 'NOT_SUPPORTED_DEX' && 
           wallet.publicKey() && 
           props.verification.tokenData?.mint;
  });

  return (
    <div class={`${info().bgColor} border ${info().borderColor} rounded-lg p-4 ${props.class || ''}`}>
      <div class="flex items-start space-x-3">
        <span class="text-2xl flex-shrink-0">{info().icon}</span>
        
        <div class="flex-1 min-w-0">
          {/* Title */}
          <h4 class={`font-semibold ${info().textColor}`}>
            {info().title}
          </h4>
          
          {/* Reason */}
          <p class={`mt-1 text-sm ${info().textColor} opacity-90`}>
            {props.verification.reason}
          </p>
          
          {/* Pool Balance Visual for POOL_IMBALANCED */}
          <Show when={props.verification.poolBalance && props.verification.rejectionCode === 'POOL_IMBALANCED'}>
            <PoolBalanceVisual poolBalance={props.verification.poolBalance!} />
          </Show>
          
          {/* Helpful Tips */}
          <Show when={props.verification.rejectionCode}>
            <HelpfulTips rejectionCode={props.verification.rejectionCode as TokenRejectionCode} />
          </Show>
        </div>
      </div>
      
      {/* Rejection Code Badge */}
      <Show when={props.verification.rejectionCode}>
        <div class="mt-3 flex justify-end">
          <span class={`
            px-2 py-1 rounded text-xs font-mono
            ${info().bgColor} ${info().textColor} border ${info().borderColor}
          `}>
            {props.verification.rejectionCode}
          </span>
        </div>
      </Show>
      
      {/* Manual Verification Request Section */}
      <Show when={canRequestVerification()}>
        <div class="mt-4 pt-4 border-t border-gray-200">
          <Show when={requestStatus() === 'idle' || requestStatus() === 'error' || requestStatus() === 'rate-limited'}>
            <div>
              <h5 class="text-sm font-medium text-gray-900 mb-2">
                Request Manual Verification
              </h5>
              <p class="text-xs text-gray-600 mb-3">
                Think this token should be supported? Request manual verification by our team.
              </p>
              
              <Show when={!wallet.publicKey()}>
                <p class="text-xs text-orange-600 mb-2">
                  Please connect your wallet to request verification.
                </p>
              </Show>
              
              <Show when={wallet.publicKey()}>
                <div class="space-y-3">
                  <div>
                    <label for="reason" class="block text-xs font-medium text-gray-700 mb-1">
                      Reason (optional)
                    </label>
                    <textarea
                      id="reason"
                      rows={2}
                      value={reason()}
                      onInput={(e) => setReason(e.currentTarget.value)}
                      placeholder="Why should this token be supported?"
                      class="w-full px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      maxLength={200}
                    />
                    <p class="mt-1 text-xs text-gray-500">
                      {reason().length}/200 characters
                    </p>
                  </div>
                  
                  <button
                    onClick={handleVerificationRequest}
                    disabled={requestLoading()}
                    class="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Show when={requestLoading()}>
                      <span class="flex items-center justify-center">
                        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Submitting...
                      </span>
                    </Show>
                    <Show when={!requestLoading()}>
                      Submit Request
                    </Show>
                  </button>
                  
                  <Show when={requestStatus() === 'error'}>
                    <p class="text-xs text-red-600">
                      {requestError()}
                    </p>
                  </Show>
                  
                  <Show when={requestStatus() === 'rate-limited'}>
                    <p class="text-xs text-orange-600">
                      {requestError()}
                    </p>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
          
          <Show when={requestStatus() === 'success'}>
            <div class="text-center py-4">
              <svg class="mx-auto h-12 w-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h5 class="mt-3 text-sm font-medium text-gray-900">
                Request Submitted!
              </h5>
              <p class="mt-2 text-xs text-gray-600">
                We'll review your request and notify you via the app. This typically takes 24-48 hours.
              </p>
            </div>
          </Show>
          
          <Show when={requestStatus() === 'already-requested'}>
            <div class="text-center py-4">
              <svg class="mx-auto h-12 w-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h5 class="mt-3 text-sm font-medium text-gray-900">
                Already Under Review
              </h5>
              <p class="mt-2 text-xs text-gray-600">
                A verification request for this token is already pending review.
              </p>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function PoolBalanceVisual(props: { poolBalance: PoolBalanceInfo }) {
  return (
    <div class="mt-3 space-y-2">
      {/* Progress Bar */}
      <div class="h-4 rounded-full overflow-hidden flex bg-gray-200">
        <div 
          class="bg-red-400 transition-all duration-300"
          style={{ width: `${props.poolBalance.baseTokenPercent}%` }}
        />
        <div 
          class="bg-green-400 transition-all duration-300"
          style={{ width: `${props.poolBalance.quoteTokenPercent}%` }}
        />
      </div>
      
      {/* Labels */}
      <div class="flex justify-between text-xs">
        <span class="flex items-center gap-1">
          <span class="w-3 h-3 rounded bg-red-400 inline-block" />
          Token: {props.poolBalance.baseTokenPercent.toFixed(1)}%
        </span>
        <span class="flex items-center gap-1">
          <span class="w-3 h-3 rounded bg-green-400 inline-block" />
          {props.poolBalance.quoteToken}: {props.poolBalance.quoteTokenPercent.toFixed(1)}%
        </span>
      </div>
      
      <p class="text-xs font-medium text-yellow-700">
        ⚡ Required: At least 20% {props.poolBalance.quoteToken} for safe liquidation
      </p>
    </div>
  );
}

function HelpfulTips(props: { rejectionCode: TokenRejectionCode }) {
  const tips = createMemo(() => {
    switch (props.rejectionCode) {
      case 'NOT_SUPPORTED_DEX':
        return (
          <div class="mt-2 text-xs opacity-75">
            <p>Supported tokens:</p>
            <ul class="list-disc list-inside mt-1 ml-2">
              <li>PumpFun (address ends in "pump")</li>
              <li>Bonk/Raydium (address ends in "bonk")</li>
            </ul>
          </div>
        );
      case 'POOL_IMBALANCED':
        return (
          <div class="mt-2 text-xs opacity-75">
            <p>This protects you from:</p>
            <ul class="list-disc list-inside mt-1 ml-2">
              <li>High slippage during liquidation</li>
              <li>Potential loss of collateral value</li>
            </ul>
          </div>
        );
      case 'INSUFFICIENT_LIQUIDITY':
        return (
          <div class="mt-2 text-xs opacity-75">
            <p>Low liquidity pools are risky:</p>
            <ul class="list-disc list-inside mt-1 ml-2">
              <li>Price can be easily manipulated</li>
              <li>Difficult to sell during liquidation</li>
            </ul>
          </div>
        );
      case 'TOKEN_TOO_NEW':
        return (
          <div class="mt-2 text-xs opacity-75">
            <p>This protects you from:</p>
            <ul class="list-disc list-inside mt-1 ml-2">
              <li>Rug pulls and exit scams</li>
              <li>Price manipulation on new tokens</li>
              <li>Pump & dump schemes</li>
            </ul>
          </div>
        );
      case 'WHITELIST_FAILED':
        return (
          <div class="mt-2 text-xs opacity-75">
            <p>Try again in a few moments, or check if the token address is correct.</p>
          </div>
        );
      default:
        return null;
    }
  });

  return <>{tips()}</>;
}

export default TokenRejectionDisplay;