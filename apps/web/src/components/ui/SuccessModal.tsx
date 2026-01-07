import { Show, For, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from './Button';
import { CopyIconButton } from './CopyButton';

interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  details: Array<{ label: string; value: string; highlight?: boolean }>;
  transactionSignature?: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export function SuccessModal(props: SuccessModalProps) {
  // Handle ESC key
  createEffect(() => {
    if (!props.isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });
  
  // Prevent body scroll when modal is open
  createEffect(() => {
    if (props.isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    
    onCleanup(() => {
      document.body.style.overflow = '';
    });
  });
  
  
  const formatAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };
  
  return (
    <Show when={props.isOpen}>
      <Portal>
        <div 
          class="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              props.onClose();
            }
          }}
        >
          <div class="bg-bg-secondary border-2 border-accent-green p-6 max-w-lg w-full animate-scale-in">
            {/* Success Icon */}
            <div class="flex justify-center mb-6">
              <div class="relative">
                <div class="w-16 h-16 bg-accent-green/20 rounded-full flex items-center justify-center animate-pulse-slow">
                  <svg class="w-8 h-8 text-accent-green animate-check-mark" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            </div>
            
            {/* Title & Subtitle */}
            <div class="text-center mb-6">
              <h2 class="text-xl font-bold text-accent-green mb-2">{props.title}</h2>
              <Show when={props.subtitle}>
                <p class="text-sm text-text-dim">{props.subtitle}</p>
              </Show>
            </div>
            
            {/* Details Grid */}
            <div class="bg-bg-primary border border-border p-4 mb-6 space-y-3">
              <For each={props.details}>
                {(detail) => (
                  <div class="flex justify-between items-center">
                    <span class="text-xs text-text-dim uppercase">{detail.label}</span>
                    <span class={`font-mono text-sm ${
                      detail.highlight ? 'text-accent-green font-semibold' : 'text-text-primary'
                    }`}>
                      {detail.value}
                    </span>
                  </div>
                )}
              </For>
            </div>
            
            {/* Transaction Link */}
            <Show when={props.transactionSignature}>
              <div class="mb-6 bg-bg-primary border border-border p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex-1">
                    <div class="text-xs text-text-dim mb-1">TRANSACTION HASH</div>
                    <div class="font-mono text-xs text-accent-blue">
                      {formatAddress(props.transactionSignature!)}
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <CopyIconButton
                      text={props.transactionSignature!}
                      successMessage="Transaction hash copied to clipboard!"
                      title="Copy transaction hash"
                    />
                    <a
                      href={`https://solscan.io/tx/${props.transactionSignature}${import.meta.env.VITE_SOLANA_NETWORK === 'devnet' ? '?cluster=devnet' : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="p-2 bg-bg-secondary border border-border hover:border-accent-blue hover:text-accent-blue transition-colors"
                      title="View on Solscan"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </Show>
            
            {/* Actions */}
            <div class="flex gap-3">
              <Show when={props.primaryAction}>
                <Button
                  onClick={() => {
                    props.primaryAction!.onClick();
                    props.onClose();
                  }}
                  size="md"
                  class="flex-1"
                >
                  {props.primaryAction!.label}
                </Button>
              </Show>
              <Show when={props.secondaryAction}>
                <Button
                  onClick={() => {
                    props.secondaryAction!.onClick();
                    props.onClose();
                  }}
                  variant="secondary"
                  size="md"
                  class="flex-1"
                >
                  {props.secondaryAction!.label}
                </Button>
              </Show>
              <Show when={!props.primaryAction && !props.secondaryAction}>
                <Button
                  onClick={props.onClose}
                  size="md"
                  class="w-full"
                >
                  Close
                </Button>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

// Add these styles to your global CSS or Tailwind config
const modalStyles = `
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scale-in {
  from { 
    opacity: 0;
    transform: scale(0.95);
  }
  to { 
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes check-mark {
  0% {
    stroke-dasharray: 0 100;
  }
  100% {
    stroke-dasharray: 100 100;
  }
}

@keyframes pulse-slow {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.animate-fade-in {
  animation: fade-in 0.2s ease-out;
}

.animate-scale-in {
  animation: scale-in 0.3s ease-out;
}

.animate-check-mark {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: check-mark 0.5s ease-out 0.2s forwards;
}

.animate-pulse-slow {
  animation: pulse-slow 2s ease-in-out infinite;
}
`;