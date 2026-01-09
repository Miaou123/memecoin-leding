import { Show, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { ParsedError } from '@/lib/error-parser';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  error: ParsedError | null;
  onRetry?: () => void;
}

export function ErrorModal(props: ErrorModalProps) {
  // Close on Escape key
  createEffect(() => {
    if (!props.isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    
    document.addEventListener('keydown', handleEscape);
    onCleanup(() => document.removeEventListener('keydown', handleEscape));
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

  const severityColors = {
    info: 'accent-blue',
    warning: 'accent-yellow',
    error: 'accent-red',
    critical: 'accent-red',
  };

  return (
    <Show when={props.isOpen && props.error}>
      <Portal>
        <div class="fixed inset-0 z-50">
          {/* Backdrop */}
          <div 
            class="absolute inset-0 bg-black/80 animate-fade-in"
            onClick={props.onClose}
          />
          
          {/* Modal */}
          <div class="absolute inset-0 flex items-center justify-center p-4">
            <div class="bg-bg-secondary border border-border w-full max-w-md animate-scale-in">
              {/* Header */}
              <div class="border-b border-border p-4 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class={`text-${severityColors[props.error!.severity]}`}>⚠</span>
                  <span class="text-xs text-text-dim uppercase tracking-wider">SYSTEM_ERROR</span>
                </div>
                <button 
                  onClick={props.onClose}
                  class="text-text-dim hover:text-text-primary transition-colors text-xl leading-none"
                >
                  ×
                </button>
              </div>
              
              {/* Body */}
              <div class="p-6 text-center">
                <div class={`w-16 h-16 bg-${severityColors[props.error!.severity]}/20 border border-${severityColors[props.error!.severity]} flex items-center justify-center mx-auto mb-4`}>
                  <span class={`text-${severityColors[props.error!.severity]} text-3xl`}>!</span>
                </div>
                
                <h3 class="text-xl font-bold text-text-primary mb-2">
                  {props.error!.title}
                </h3>
                
                <p class="text-text-secondary text-sm">
                  {props.error!.description}
                </p>
                
                <Show when={props.error!.suggestion}>
                  <p class="text-text-dim text-xs mt-2">
                    💡 {props.error!.suggestion}
                  </p>
                </Show>
                
                {/* Error details (collapsible/terminal style) */}
                <div class="mt-4 p-3 bg-bg-tertiary border border-border text-left">
                  <div class="text-text-dim text-xs font-mono">
                    <span class="text-accent-green">&gt;</span> error_code: {props.error!.code}<br/>
                    <span class="text-accent-green">&gt;</span> error_name: {props.error!.name}<br/>
                    <span class="text-accent-green">&gt;</span> timestamp: {new Date().toISOString()}
                  </div>
                </div>
              </div>
              
              {/* Footer */}
              <div class="border-t border-border p-4 flex gap-3">
                <button 
                  onClick={props.onClose}
                  class="flex-1 py-2.5 bg-bg-tertiary border border-border text-text-primary hover:bg-border transition-colors text-sm uppercase tracking-wider"
                >
                  [CLOSE]
                </button>
                <Show when={props.onRetry}>
                  <button 
                    onClick={() => {
                      props.onClose();
                      props.onRetry?.();
                    }}
                    class="flex-1 py-2.5 bg-accent-green text-bg-primary hover:bg-accent-green/90 transition-colors text-sm uppercase tracking-wider"
                  >
                    [RETRY]
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}