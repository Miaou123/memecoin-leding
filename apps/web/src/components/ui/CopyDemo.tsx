import { CopyButton, CopyIconButton, CopyableText } from './CopyButton';

export function CopyDemo() {
  return (
    <div class="p-4 space-y-4 bg-bg-secondary border border-border">
      <h3 class="text-lg font-bold text-text-primary">Copy Functionality Demo</h3>
      
      <div class="space-y-3">
        {/* Copyable text example */}
        <div>
          <label class="text-sm text-text-dim">Token Address (click to copy):</label>
          <div class="mt-1">
            <CopyableText
              text="6KHL8uUXFie8Xdy3EBvw6EgruiU3duc9fvGrWoZ9pump"
              successMessage="Token address copied!"
              class="bg-bg-primary border border-border p-2 rounded"
            />
          </div>
        </div>

        {/* Copy button with custom text */}
        <div>
          <CopyButton
            text="This is some example text to copy"
            successMessage="Example text copied to clipboard!"
            class="bg-accent-green text-white px-4 py-2 rounded hover:bg-accent-green/80"
          >
            Copy Example Text
          </CopyButton>
        </div>

        {/* Icon-only copy button */}
        <div class="flex items-center gap-2">
          <span class="text-sm text-text-secondary">Transaction Hash:</span>
          <span class="font-mono text-xs text-accent-blue bg-bg-primary px-2 py-1 rounded">
            abc123...def456
          </span>
          <CopyIconButton
            text="abc123def456789abcdef123456789"
            successMessage="Transaction hash copied!"
          />
        </div>
      </div>
    </div>
  );
}