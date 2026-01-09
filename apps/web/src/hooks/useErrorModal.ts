import { createSignal } from 'solid-js';
import { parseError, ParsedError } from '@/lib/error-parser';

export function useErrorModal() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [error, setError] = createSignal<ParsedError | null>(null);
  const [retryFn, setRetryFn] = createSignal<(() => void) | undefined>(undefined);

  const showError = (err: Error | string, onRetry?: () => void) => {
    const parsed = parseError(err);
    setError(parsed);
    setRetryFn(() => onRetry);
    setIsOpen(true);
  };

  const hideError = () => {
    setIsOpen(false);
    // Clear error after animation
    setTimeout(() => {
      setError(null);
      setRetryFn(undefined);
    }, 200);
  };

  return {
    isOpen,
    error,
    retryFn,
    showError,
    hideError,
  };
}