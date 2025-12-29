import { formatSOL, formatTimeAgo } from '@/lib/utils';

export interface RecentLoanItemProps {
  loan: {
    id: string;
    tokenSymbol: string;
    tokenName: string;
    amount: string;
    status: 'Active' | 'AtRisk' | 'Repaid';
    createdAt: number;
  };
}

export function RecentLoanItem(props: RecentLoanItemProps) {
  const getStatusBadge = () => {
    const { status } = props.loan;
    
    switch (status) {
      case 'Active':
        return (
          <span class="text-xs font-mono text-accent-green border border-accent-green px-2 py-1">
            [ACTIVE]
          </span>
        );
      case 'AtRisk':
        return (
          <span class="text-xs font-mono text-accent-yellow border border-accent-yellow px-2 py-1">
            [AT_RISK]
          </span>
        );
      case 'Repaid':
        return (
          <span class="text-xs font-mono text-text-secondary border border-border px-2 py-1 opacity-60">
            [REPAID]
          </span>
        );
      default:
        return null;
    }
  };

  const getItemClasses = () => {
    const baseClasses = "flex items-center justify-between p-3 border border-border hover:border-accent-green transition-colors";
    
    if (props.loan.status === 'AtRisk') {
      return `${baseClasses} border-accent-yellow`;
    }
    
    if (props.loan.status === 'Repaid') {
      return `${baseClasses} opacity-60`;
    }
    
    return baseClasses;
  };

  return (
    <div class={getItemClasses()}>
      <div class="flex items-center gap-3">
        {/* Token Avatar */}
        <div class="w-8 h-8 bg-bg-tertiary border border-border flex items-center justify-center">
          <span class="text-xs font-bold text-text-primary">
            {props.loan.tokenSymbol.slice(0, 2).toUpperCase()}
          </span>
        </div>
        
        {/* Token Info */}
        <div>
          <div class="text-sm font-mono text-text-primary">
            {props.loan.tokenSymbol}
          </div>
          <div class="text-xs text-text-dim">
            {formatTimeAgo(props.loan.createdAt)}
          </div>
        </div>
      </div>
      
      {/* Amount and Status */}
      <div class="flex items-center gap-3">
        <div class="text-right">
          <div class="text-sm font-mono text-text-primary">
            {formatSOL(props.loan.amount)} SOL
          </div>
        </div>
        {getStatusBadge()}
      </div>
    </div>
  );
}