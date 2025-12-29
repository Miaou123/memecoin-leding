import { formatSOL, formatNumber } from '@/lib/utils';

export interface ProtocolHealthProps {
  available: string;
  borrowed: string;
  utilization: number;
}

export function ProtocolHealth(props: ProtocolHealthProps) {
  const getUtilizationColor = () => {
    const { utilization } = props;
    if (utilization < 50) return 'accent-green';
    if (utilization < 80) return 'accent-yellow';
    return 'accent-red';
  };

  const getUtilizationBarWidth = () => {
    return Math.min(props.utilization, 100);
  };

  return (
    <div class="bg-bg-secondary border border-border p-6">
      <div class="text-xs text-text-dim mb-4">PROTOCOL_HEALTH:</div>
      
      {/* Utilization Percentage */}
      <div class="mb-4">
        <div class={`text-2xl font-bold text-${getUtilizationColor()} mb-2`}>
          {formatNumber(props.utilization, { maximumFractionDigits: 1 })}%
        </div>
        <div class="text-xs text-text-dim mb-2">UTILIZATION</div>
        
        {/* Progress Bar */}
        <div class="h-2 bg-bg-tertiary border border-border overflow-hidden">
          <div 
            class={`h-full bg-${getUtilizationColor()} transition-all duration-300`}
            style={{ width: `${getUtilizationBarWidth()}%` }}
          ></div>
        </div>
      </div>
      
      {/* Available vs Borrowed */}
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-xs text-text-dim mb-1">AVAILABLE</div>
          <div class="text-lg font-mono text-text-primary">
            {formatSOL(props.available)}
          </div>
          <div class="text-xs text-text-secondary">SOL</div>
        </div>
        
        <div>
          <div class="text-xs text-text-dim mb-1">BORROWED</div>
          <div class="text-lg font-mono text-text-primary">
            {formatSOL(props.borrowed)}
          </div>
          <div class="text-xs text-text-secondary">SOL</div>
        </div>
      </div>
      
      {/* Health Status */}
      <div class="mt-4 pt-4 border-t border-border">
        <div class="text-xs text-text-dim">
          STATUS: <span class={`text-${getUtilizationColor()}`}>
            {props.utilization < 50 ? 'HEALTHY' : 
             props.utilization < 80 ? 'MODERATE' : 'HIGH_UTILIZATION'}
          </span>
        </div>
      </div>
    </div>
  );
}