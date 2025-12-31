import { Show, createSignal, onCleanup } from 'solid-js';

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  visible: boolean;
  onClose: () => void;
}

export function Toast(props: ToastProps) {
  const getTypeStyles = () => {
    switch (props.type || 'success') {
      case 'success':
        return 'bg-accent-green/90 text-white border-accent-green';
      case 'error':
        return 'bg-accent-red/90 text-white border-accent-red';
      case 'info':
        return 'bg-accent-blue/90 text-white border-accent-blue';
      default:
        return 'bg-accent-green/90 text-white border-accent-green';
    }
  };

  return (
    <Show when={props.visible}>
      <div class={`
        fixed top-4 right-4 z-50
        px-4 py-3 rounded border-l-4
        ${getTypeStyles()}
        shadow-lg backdrop-blur-sm
        font-mono text-sm
        transform transition-all duration-300 ease-in-out
        ${props.visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        max-w-sm
      `}>
        <div class="flex items-center justify-between">
          <span>{props.message}</span>
          <button
            onClick={props.onClose}
            class="ml-3 text-white/80 hover:text-white transition-colors"
          >
            ×
          </button>
        </div>
      </div>
    </Show>
  );
}

// Toast manager for creating and managing multiple toasts
interface ToastItem extends Omit<ToastProps, 'visible' | 'onClose'> {
  id: string;
}

// Global toast state
let toasts: () => ToastItem[] = () => [];
let setToasts: (fn: (prev: ToastItem[]) => ToastItem[]) => void = () => {};

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'success', duration = 3000) {
  const id = Date.now().toString();
  const toast: ToastItem = { id, message, type, duration };
  
  setToasts(prev => [...prev, toast]);
  
  // Auto remove after duration
  setTimeout(() => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, duration);
  
  return id;
}

export function removeToast(id: string) {
  setToasts(prev => prev.filter(t => t.id !== id));
}

export function ToastContainer() {
  // Initialize the signals inside the component
  const [localToasts, setLocalToasts] = createSignal<ToastItem[]>([]);
  toasts = localToasts;
  setToasts = setLocalToasts;
  
  return (
    <div class="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
      <For each={localToasts()}>
        {(toast) => (
          <div class="pointer-events-auto">
            <Toast
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              visible={true}
              onClose={() => removeToast(toast.id)}
            />
          </div>
        )}
      </For>
    </div>
  );
}