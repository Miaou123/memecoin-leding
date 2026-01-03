import { Show, createMemo } from 'solid-js';
import { Button } from '@/components/ui/Button';
import { TokenImage } from '@/components/tokens/TokenImage';
import { formatSOL, formatNumber } from '@/lib/utils';
import { Loan, LoanStatus } from '@memecoin-lending/types';

interface TokenMetadata {
  symbol: string;
  name: string;
  logoUri?: string;
}

interface LoanCardProps {
  loan: Loan & { token?: TokenMetadata };
  onRepay?: () => void;
  onView?: () => void;
}

export function LoanCard(props: LoanCardProps) {
  const getStatusInfo = (status: LoanStatus) => {
    switch (status) {
      case LoanStatus.Active:
        const timeLeft = props.loan.dueAt - Date.now() / 1000;
        const hoursLeft = timeLeft / 3600;
        if (hoursLeft <= 2) {
          return { label: '[CRITICAL]', class: 'bg-accent-red/20 text-accent-red animate-pulse' };
        } else if (hoursLeft <= 6) {
          return { label: '[AT_RISK]', class: 'bg-accent-yellow/20 text-accent-yellow animate-pulse' };
        }
        return { label: '[ACTIVE]', class: 'bg-accent-green/20 text-accent-green' };
      case LoanStatus.Repaid:
        return { label: '[REPAID]', class: 'bg-text-dim/20 text-text-secondary' };
      case LoanStatus.LiquidatedTime:
      case LoanStatus.LiquidatedPrice:
        return { label: '[LIQUIDATED]', class: 'bg-accent-red/20 text-accent-red' };
      default:
        return { label: '[UNKNOWN]', class: 'bg-text-dim/20 text-text-dim' };
    }
  };
  
  const getHealthPercentage = createMemo(() => {
    if (props.loan.status !== LoanStatus.Active) return 100;
    
    // Simple health calculation based on time remaining
    const timeLeft = props.loan.dueAt - Date.now() / 1000;
    const totalDuration = props.loan.dueAt - props.loan.createdAt;
    const timeUsed = totalDuration - timeLeft;
    const timePercentage = Math.max(0, Math.min(100, (timeUsed / totalDuration) * 100));
    
    // Invert so 100% is healthy (just created), 0% is unhealthy (about to expire)
    return Math.max(0, 100 - timePercentage);
  });
  
  const getHealthColor = (health: number): string => {
    if (health >= 70) return 'accent-green';
    if (health >= 40) return 'accent-yellow';
    return 'accent-red';
  };
  
  const getCardBorderClass = () => {
    if (props.loan.status !== LoanStatus.Active) return 'border-border';
    
    const health = getHealthPercentage();
    if (health < 40) return 'border-accent-red';
    if (health < 70) return 'border-accent-yellow';
    return 'border-border hover:border-accent-green';
  };
  
  const formatTimeRemaining = (dueAt: number) => {
    const timeLeft = dueAt - Date.now() / 1000;
    if (timeLeft <= 0) return 'OVERDUE';
    
    const days = Math.floor(timeLeft / 86400);
    const hours = Math.floor((timeLeft % 86400) / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };
  
  const statusInfo = () => getStatusInfo(props.loan.status);
  const healthColor = () => getHealthColor(getHealthPercentage());
  
  return (
    <div class={`bg-bg-secondary border-2 ${getCardBorderClass()} transition-colors cursor-pointer`}>
      {/* Header */}
      <div class="bg-bg-tertiary border-b border-border p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <TokenImage
            src={props.loan.token?.logoUri}
            symbol={props.loan.token?.symbol || 'UNK'}
            size="md"
          />
          <div>
            <div class="font-bold text-sm text-text-primary">
              {props.loan.token?.symbol || 'UNKNOWN'}
            </div>
            <div class="text-text-dim text-xs">
              {props.loan.token?.name || 'Unknown Token'}
            </div>
          </div>
        </div>
        
        <div class={`px-2 py-1 text-xs font-mono ${statusInfo().class}`}>
          {statusInfo().label}
        </div>
      </div>
      
      {/* Body */}
      <div class="p-4 space-y-3">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-text-dim text-xs uppercase">SOL_BORROWED</div>
            <div class="font-bold text-text-primary">{formatSOL(props.loan.solBorrowed)} SOL</div>
          </div>
          <div>
            <div class="text-text-dim text-xs uppercase">COLLATERAL</div>
            <div class="font-medium text-text-primary">
              {formatNumber(parseFloat(props.loan.collateralAmount) / 1e6)} {props.loan.token?.symbol || 'tokens'}
            </div>
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-text-dim text-xs uppercase">PROTOCOL_FEE</div>
            <div class="font-medium text-text-primary">
              1%
            </div>
          </div>
          <div>
            <div class="text-text-dim text-xs uppercase">TIME_REMAINING</div>
            <div class="font-medium text-text-primary">
              <Show when={props.loan.status === LoanStatus.Active} fallback="--">
                {formatTimeRemaining(props.loan.dueAt)}
              </Show>
            </div>
          </div>
        </div>
        
        {/* Health Bar */}
        <Show when={props.loan.status === LoanStatus.Active}>
          <div>
            <div class="text-text-dim text-xs uppercase mb-1">HEALTH</div>
            <div class="h-2 bg-bg-tertiary border border-border">
              <div 
                class={`h-full bg-${healthColor()} transition-all duration-300`}
                style={`width: ${getHealthPercentage()}%`}
              />
            </div>
          </div>
        </Show>
      </div>
      
      {/* Footer */}
      <div class="p-4 pt-0 flex gap-2">
        <Show when={props.loan.status === LoanStatus.Active}>
          <Button
            variant="primary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              props.onRepay?.();
            }}
          >
            [REPAY]
          </Button>
        </Show>
        
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            props.onView?.();
          }}
        >
          [VIEW]
        </Button>
      </div>
    </div>
  );
}