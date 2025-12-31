import { showToast } from './Toast';

interface CopyButtonProps {
  text: string;
  successMessage?: string;
  errorMessage?: string;
  class?: string;
  title?: string;
  children?: any;
}

export function CopyButton(props: CopyButtonProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      showToast(
        props.successMessage || 'Copied to clipboard!', 
        'success'
      );
    } catch (err) {
      console.error('Failed to copy:', err);
      showToast(
        props.errorMessage || 'Failed to copy to clipboard', 
        'error'
      );
    }
  };

  return (
    <button
      onClick={handleCopy}
      class={`transition-colors cursor-pointer ${props.class || ''}`}
      title={props.title || 'Click to copy'}
      type="button"
    >
      {props.children}
    </button>
  );
}

// Simple icon-only copy button
export function CopyIconButton(props: Omit<CopyButtonProps, 'children'>) {
  return (
    <CopyButton
      text={props.text}
      successMessage={props.successMessage}
      errorMessage={props.errorMessage}
      class={`p-2 bg-bg-secondary border border-border hover:border-accent-blue hover:text-accent-blue transition-colors ${props.class || ''}`}
      title={props.title}
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
      </svg>
    </CopyButton>
  );
}

// Text with copy functionality
export function CopyableText(props: CopyButtonProps & { displayText?: string }) {
  return (
    <CopyButton
      text={props.text}
      successMessage={props.successMessage}
      errorMessage={props.errorMessage}
      class={`font-mono text-sm text-text-primary hover:text-accent-green transition-colors ${props.class || ''}`}
      title={props.title}
    >
      {props.displayText || props.text}
    </CopyButton>
  );
}