import { Show, createMemo } from 'solid-js';
import { formatSOL, formatNumber } from '@/lib/utils';
import type { LoanEstimate as LoanEstimateData } from '@memecoin-lending/types';

interface LoanEstimateProps {
  estimate: LoanEstimateData;
  collateralAmount: string;
  tokenPrice?: number;
  solPrice?: number;
}

export function LoanEstimate(props: LoanEstimateProps) {
  // Calculate collateral value
  const collateralValue = createMemo(() => {
    if (!props.tokenPrice || !props.collateralAmount) return 0;
    const amount = parseFloat(props.collateralAmount) || 0;
    return amount * props.tokenPrice;
  });

  return (
    <div class="bg-bg-secondary border border-green-800 rounded-lg">
      {/* Header */}
      <div class="flex justify-between items-center p-3 border-b border-green-800">
        <span class="text-[10px] uppercase tracking-wider text-text-secondary">
          LOAN ESTIMATE
        </span>
        <span class="border border-accent-green text-accent-green px-2 py-1 text-[10px] uppercase">
          VERIFIED
        </span>
      </div>
      
      {/* Body - no padding on container */}
      <div>
        {/* You'll Receive */}
        <div class="flex justify-between items-center px-3 py-2 border-b border-green-800">
          <span class="text-xs text-text-secondary">You'll Receive</span>
          <span class="text-sm font-bold text-accent-green">
            {formatSOL(props.estimate.solAmount)} SOL
          </span>
        </div>
        
        {/* Collateral Value */}
        <div class="flex justify-between items-center px-3 py-2 border-b border-green-800">
          <span class="text-xs text-text-secondary">Collateral Value</span>
          <span class="text-xs font-medium text-text-primary">
            ${formatNumber(collateralValue())}
          </span>
        </div>
        
        {/* LTV Ratio */}
        <div class="flex justify-between items-center px-3 py-2 border-b border-green-800">
          <span class="text-xs text-text-secondary">LTV Ratio</span>
          <span class="text-xs font-medium text-text-primary">
            {props.estimate.ltv}%
          </span>
        </div>
        
        {/* Protocol Fee */}
        <div class="flex justify-between items-center px-3 py-2 border-b border-green-800">
          <span class="text-xs text-text-secondary">Protocol Fee</span>
          <span class="text-xs font-medium text-text-primary">
            2.0%
          </span>
        </div>
        
        {/* Total to Repay */}
        <div class="flex justify-between items-center px-3 py-2 border-b border-green-800">
          <span class="text-xs text-text-secondary">Total to Repay</span>
          <span class="text-xs font-medium text-text-primary">
            {formatSOL(props.estimate.totalOwed)} SOL
          </span>
        </div>
        
        {/* Liquidation Price */}
        <div class="flex justify-between items-center px-3 py-2">
          <span class="text-xs text-text-secondary">Liquidation Price</span>
          <span class="text-xs font-medium text-accent-red">
            ${formatNumber(props.estimate.liquidationPrice)}
          </span>
        </div>
      </div>
    </div>
  );
}