import { Show } from 'solid-js';
import { A } from '@solidjs/router';
import { Loan, LoanStatus } from '@memecoin-lending/types';
import { Button } from '@/components/ui/Button';
import { formatSOL, formatTimeRemaining, formatPercentage } from '@/lib/utils';

interface LoanCardProps {
  loan: Loan;
}

export function LoanCard(props: LoanCardProps) {
  const getStatusStyle = (status: LoanStatus) => {
    switch (status) {
      case LoanStatus.Active:
        return 'text-accent-green';
      case LoanStatus.Repaid:
        return 'text-accent-blue';
      case LoanStatus.LiquidatedTime:
      case LoanStatus.LiquidatedPrice:
        return 'text-accent-red';
      default:
        return 'text-text-dim';
    }
  };
  
  const getStatusText = (status: LoanStatus) => {
    switch (status) {
      case LoanStatus.Active:
        return 'ACTIVE';
      case LoanStatus.Repaid:
        return 'REPAID';
      case LoanStatus.LiquidatedTime:
        return 'LIQ_TIME';
      case LoanStatus.LiquidatedPrice:
        return 'LIQ_PRICE';
      default:
        return status.toString().toUpperCase();
    }
  };
  
  const isOverdue = () => {
    return props.loan.status === LoanStatus.Active && 
           Date.now() / 1000 > props.loan.dueAt;
  };
  
  const healthRatio = () => {
    const currentTime = Date.now() / 1000;
    const timeRemaining = props.loan.dueAt - currentTime;
    const totalDuration = props.loan.dueAt - props.loan.createdAt;
    
    return Math.max(0, timeRemaining / totalDuration * 100);
  };
  
  return (
    <div class="bg-bg-secondary border border-border font-mono p-4 hover:border-accent-green transition-colors">
      {/* Header with ID and Status */}
      <div class="flex items-center justify-between mb-4 border-b border-border pb-2">
        <div class="text-xs text-text-dim">
          LOAN_ID: {props.loan.pubkey.slice(0, 8)}...
        </div>
        <div class={`text-xs font-semibold ${getStatusStyle(props.loan.status)}`}>
          [{getStatusText(props.loan.status)}]
        </div>
      </div>

      {/* Core Loan Data */}
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div class="text-xs text-text-dim mb-1">SOL_BORROWED</div>
          <div class="text-text-primary font-semibold">
            {formatSOL(props.loan.solBorrowed)}
          </div>
        </div>
        <div>
          <div class="text-xs text-text-dim mb-1">INTEREST_APR</div>
          <div class="text-accent-yellow font-semibold">
            {formatPercentage(props.loan.interestRateBps / 100)}%
          </div>
        </div>
      </div>

      {/* Collateral Info */}
      <div class="mb-4">
        <div class="text-xs text-text-dim mb-1">COLLATERAL_AMOUNT</div>
        <div class="text-text-primary">
          {formatSOL(props.loan.collateralAmount)} tokens
        </div>
      </div>
      
      <Show when={props.loan.status === LoanStatus.Active}>
        <div class="space-y-3 mb-4 border-t border-border pt-3">
          <div class="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div class="text-text-dim">TIME_REMAINING</div>
              <div class={isOverdue() ? 'text-accent-red font-semibold' : 'text-text-primary'}>
                {formatTimeRemaining(props.loan.dueAt)}
              </div>
            </div>
            <div>
              <div class="text-text-dim">LIQ_PRICE</div>
              <div class="text-accent-red">
                ${parseFloat(props.loan.liquidationPrice).toFixed(6)}
              </div>
            </div>
          </div>
          
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-text-dim">HEALTH_RATIO</span>
              <span class={healthRatio() > 50 ? 'text-accent-green' : 'text-accent-yellow'}>
                {healthRatio().toFixed(1)}%
              </span>
            </div>
            <div class="w-full bg-bg-tertiary h-2">
              <div 
                class={`h-2 transition-all ${
                  healthRatio() > 50 ? 'bg-accent-green' : 
                  healthRatio() > 25 ? 'bg-accent-yellow' : 'bg-accent-red'
                }`}
                style={`width: ${Math.max(5, healthRatio())}%`}
              />
            </div>
          </div>
        </div>
      </Show>
      
      {/* Timestamps */}
      <div class="grid grid-cols-2 gap-4 text-xs text-text-dim mb-4">
        <div>
          <span>CREATED: </span>
          <span>{new Date(props.loan.createdAt * 1000).toLocaleDateString()}</span>
        </div>
        <div>
          <span>DUE_DATE: </span>
          <span>{new Date(props.loan.dueAt * 1000).toLocaleDateString()}</span>
        </div>
      </div>
      
      {/* Actions */}
      <div class="flex gap-2 border-t border-border pt-3">
        <Show when={props.loan.status === LoanStatus.Active}>
          <A href={`/repay/${props.loan.pubkey}`} class="flex-1">
            <Button size="sm" class="w-full">
              [REPAY]
            </Button>
          </A>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              window.open(
                `https://explorer.solana.com/address/${props.loan.pubkey}`,
                '_blank'
              );
            }}
          >
            [VIEW]
          </Button>
        </Show>
        
        <Show when={props.loan.status !== LoanStatus.Active}>
          <Button 
            variant="outline" 
            size="sm"
            class="w-full"
            onClick={() => {
              window.open(
                `https://explorer.solana.com/address/${props.loan.pubkey}`,
                '_blank'
              );
            }}
          >
            [VIEW_TRANSACTION]
          </Button>
        </Show>
      </div>
    </div>
  );
}