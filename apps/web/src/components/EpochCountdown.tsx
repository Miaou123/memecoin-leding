import { createSignal, onCleanup, createEffect } from 'solid-js';

interface EpochCountdownProps {
  timeUntilNextEpoch: number; // in seconds
}

export function EpochCountdown(props: EpochCountdownProps) {
  const [timeRemaining, setTimeRemaining] = createSignal(props.timeUntilNextEpoch);
  
  createEffect(() => {
    setTimeRemaining(props.timeUntilNextEpoch);
  });
  
  const interval = setInterval(() => {
    setTimeRemaining(t => Math.max(0, t - 1));
  }, 1000);
  
  onCleanup(() => clearInterval(interval));
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div class="text-center">
      <div class="text-2xl font-bold text-accent-blue tabular-nums">
        {formatTime(timeRemaining())}
      </div>
      <div class="text-text-dim text-xs">NEXT_EPOCH_IN</div>
    </div>
  );
}