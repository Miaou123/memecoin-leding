import { Show } from 'solid-js';
import { A } from '@solidjs/router';
import { Loan, LoanStatus } from '@memecoin-lending/types';
import { Button } from '@/components/ui/Button';
import { formatSOL, formatTimeRemaining, formatPercentage } from '@/lib/utils';

interface LoanCardProps {
  loan: Loan;
}

export function LoanCard(props: LoanCardProps) {
  const getStatusColor = (status: LoanStatus) => {
    switch (status) {
      case LoanStatus.Active:
        return 'bg-green-100 text-green-800';
      case LoanStatus.Repaid:
        return 'bg-blue-100 text-blue-800';
      case LoanStatus.LiquidatedTime:
      case LoanStatus.LiquidatedPrice:
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };
  
  const getStatusText = (status: LoanStatus) => {
    switch (status) {
      case LoanStatus.Active:
        return 'Active';
      case LoanStatus.Repaid:
        return 'Repaid';
      case LoanStatus.LiquidatedTime:
        return 'Liquidated (Time)';
      case LoanStatus.LiquidatedPrice:
        return 'Liquidated (Price)';
      default:
        return status;
    }
  };
  
  const isOverdue = () => {
    return props.loan.status === LoanStatus.Active && 
           Date.now() / 1000 > props.loan.dueAt;
  };
  
  const healthRatio = () => {
    // Calculate how close the loan is to liquidation
    // This is a simplified calculation
    const currentTime = Date.now() / 1000;
    const timeRemaining = props.loan.dueAt - currentTime;
    const totalDuration = props.loan.dueAt - props.loan.createdAt;
    
    return Math.max(0, timeRemaining / totalDuration * 100);
  };
  
  return (
    <div class="bg-card p-6 rounded-lg border hover:border-primary/50 transition-colors">
      <div class="flex items-start justify-between mb-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <h3 class="font-semibold">
              {formatSOL(props.loan.solBorrowed)} SOL
            </h3>
            <span class={`px-2 py-1 text-xs rounded-full ${getStatusColor(props.loan.status)}`}>
              {getStatusText(props.loan.status)}
            </span>
          </div>
          <div class="text-sm text-muted-foreground">
            Collateral: {formatSOL(props.loan.collateralAmount)} tokens
          </div>
        </div>
        
        <div class="text-right">
          <div class="text-sm text-muted-foreground">Interest</div>
          <div class="font-medium">
            {formatPercentage(props.loan.interestRateBps / 100)} APR
          </div>
        </div>
      </div>
      
      <Show when={props.loan.status === LoanStatus.Active}>
        <div class="space-y-3 mb-4">
          <div class="flex justify-between text-sm">
            <span class="text-muted-foreground">Time Remaining</span>
            <span class={isOverdue() ? 'text-red-600 font-medium' : ''}>
              {formatTimeRemaining(props.loan.dueAt)}
            </span>
          </div>
          
          <div class="flex justify-between text-sm">
            <span class="text-muted-foreground">Liquidation Price</span>
            <span class="text-red-600">
              ${parseFloat(props.loan.liquidationPrice).toFixed(6)}
            </span>
          </div>
          
          <div class="space-y-1">
            <div class="flex justify-between text-sm">
              <span class="text-muted-foreground">Health</span>
              <span class={healthRatio() > 50 ? 'text-green-600' : 'text-yellow-600'}>
                {healthRatio().toFixed(1)}%
              </span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2">
              <div 
                class={`h-2 rounded-full transition-all ${
                  healthRatio() > 50 ? 'bg-green-500' : 
                  healthRatio() > 25 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={`width: ${Math.max(5, healthRatio())}%`}
              />
            </div>
          </div>
        </div>
      </Show>
      
      <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-4">
        <div>
          <span>Created: </span>
          <span>{new Date(props.loan.createdAt * 1000).toLocaleDateString()}</span>
        </div>
        <div>
          <span>Due: </span>
          <span>{new Date(props.loan.dueAt * 1000).toLocaleDateString()}</span>
        </div>
      </div>
      
      <div class="flex gap-2">
        <Show when={props.loan.status === LoanStatus.Active}>
          <A href={`/repay/${props.loan.pubkey}`} class="flex-1">
            <Button size="sm" class="w-full">
              Repay Loan
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
            View
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
            View Transaction
          </Button>
        </Show>
      </div>
    </div>
  );
}