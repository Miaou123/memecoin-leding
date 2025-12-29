import React from 'react';
import { TokenVerificationResult, TokenTier } from '@memecoin-lending/types';

interface TokenVerificationBadgeProps {
  verification: TokenVerificationResult | null;
  isLoading?: boolean;
  showDetails?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const tierColors = {
  [TokenTier.Bronze]: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
    icon: 'text-yellow-600',
    badge: 'bg-yellow-100',
  },
  [TokenTier.Silver]: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: 'text-blue-600',
    badge: 'bg-blue-100',
  },
  [TokenTier.Gold]: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: 'text-amber-600',
    badge: 'bg-amber-100',
  },
};

const sizeClasses = {
  sm: {
    container: 'text-xs',
    icon: 'w-3 h-3',
    spacing: 'space-x-1',
    padding: 'px-2 py-1',
  },
  md: {
    container: 'text-sm',
    icon: 'w-4 h-4',
    spacing: 'space-x-2',
    padding: 'px-3 py-2',
  },
  lg: {
    container: 'text-base',
    icon: 'w-5 h-5',
    spacing: 'space-x-3',
    padding: 'px-4 py-3',
  },
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

export function TokenVerificationBadge({
  verification,
  isLoading = false,
  showDetails = true,
  size = 'md',
  className = '',
}: TokenVerificationBadgeProps) {
  const sizeStyle = sizeClasses[size];

  // Loading state
  if (isLoading) {
    return (
      <div className={`inline-flex items-center ${sizeStyle.spacing} ${sizeStyle.padding} bg-gray-50 border border-gray-200 rounded-lg animate-pulse ${className}`}>
        <div className={`${sizeStyle.icon} bg-gray-300 rounded`}></div>
        <div className="flex-1">
          <div className="h-3 bg-gray-300 rounded w-20"></div>
          {showDetails && <div className="h-2 bg-gray-300 rounded w-16 mt-1"></div>}
        </div>
      </div>
    );
  }

  // No verification data
  if (!verification) {
    return (
      <div className={`inline-flex items-center ${sizeStyle.spacing} ${sizeStyle.padding} bg-gray-50 border border-gray-200 rounded-lg ${sizeStyle.container} text-gray-500 ${className}`}>
        <svg className={`${sizeStyle.icon} text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Unknown</span>
      </div>
    );
  }

  // Invalid token
  if (!verification.isValid) {
    return (
      <div className={`inline-flex items-start ${sizeStyle.spacing} ${sizeStyle.padding} bg-red-50 border border-red-200 rounded-lg ${sizeStyle.container} ${className}`}>
        <svg className={`${sizeStyle.icon} text-red-600 flex-shrink-0 mt-0.5`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-red-800 font-medium">Invalid Token</div>
          {showDetails && verification.reason && (
            <div className="text-red-600 text-xs mt-0.5 break-words">{verification.reason}</div>
          )}
        </div>
      </div>
    );
  }

  // Valid token
  const tierStyle = verification.tier ? tierColors[verification.tier] : {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    icon: 'text-green-600',
    badge: 'bg-green-100',
  };

  return (
    <div className={`inline-flex items-start ${sizeStyle.spacing} ${sizeStyle.padding} ${tierStyle.bg} border ${tierStyle.border} rounded-lg ${sizeStyle.container} ${className}`}>
      <svg className={`${sizeStyle.icon} ${tierStyle.icon} flex-shrink-0 mt-0.5`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      
      <div className="flex-1 min-w-0">
        <div className={`${tierStyle.text} font-medium flex items-center gap-2 flex-wrap`}>
          <span>
            {verification.isWhitelisted 
              ? verification.whitelistSource === 'manual' 
                ? 'Manually Whitelisted' 
                : 'Valid PumpFun Token'
              : 'Valid PumpFun Token'
            }
          </span>
          
          {verification.isWhitelisted && verification.whitelistSource === 'manual' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 uppercase tracking-wide">
              ADMIN
            </span>
          )}
          
          {verification.tier && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierStyle.badge} ${tierStyle.text} uppercase tracking-wide`}>
              {verification.tier}
            </span>
          )}
        </div>
        
        {showDetails && (
          <div className={`${tierStyle.text} text-xs mt-1 space-y-0.5`}>
            {verification.isWhitelisted && verification.whitelistSource === 'manual' && verification.whitelistReason && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Reason:</span>
                <span className="font-medium">{verification.whitelistReason}</span>
              </div>
            )}
            
            {verification.liquidity > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Liquidity:</span>
                <span className="font-medium">{formatLiquidity(verification.liquidity)}</span>
              </div>
            )}
            
            {verification.tier && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Max LTV:</span>
                <span className="font-medium">{getLTVForTier(verification.tier)}</span>
              </div>
            )}
            
            {verification.symbol && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Symbol:</span>
                <span className="font-medium font-mono">{verification.symbol}</span>
              </div>
            )}
            
            {verification.dexId && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">DEX:</span>
                <span className="font-medium capitalize">{verification.dexId}</span>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Source:</span>
              <span className="font-medium capitalize">
                {verification.isWhitelisted 
                  ? verification.whitelistSource === 'manual' ? 'Admin Whitelist' : 'PumpFun Auto'
                  : 'PumpFun'
                }
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TokenVerificationBadge;