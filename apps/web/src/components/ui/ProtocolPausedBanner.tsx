import { Show } from 'solid-js';

interface ProtocolPausedBannerProps {
  isPaused: boolean;
  message?: string;
}

export function ProtocolPausedBanner(props: ProtocolPausedBannerProps) {
  return (
    <Show when={props.isPaused}>
      <div class="bg-accent-red/20 border-b border-accent-red">
        <div class="container mx-auto px-4 py-3">
          <div class="flex items-center justify-center gap-3">
            <div class="flex items-center gap-2">
              <span class="text-accent-red animate-pulse">⚠</span>
              <span class="text-accent-red font-semibold text-sm uppercase tracking-wider">
                PROTOCOL_PAUSED
              </span>
            </div>
            <span class="text-text-secondary text-sm">
              {props.message || 'The protocol is temporarily paused for maintenance. Transactions are disabled.'}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}