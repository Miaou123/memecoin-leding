import { Show, createSignal, onMount } from 'solid-js';

interface TokenImageProps {
  src?: string | null;
  symbol: string;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-10 h-10',
  lg: 'w-16 h-16',
};

export function TokenImage(props: TokenImageProps) {
  const [imageError, setImageError] = createSignal(false);
  const [imageLoaded, setImageLoaded] = createSignal(false);
  
  const size = () => props.size || 'md';
  const sizeClass = () => sizeClasses[size()];
  
  // Generate fallback emoji based on symbol
  const getFallbackEmoji = (symbol: string) => {
    const symbols = symbol.toUpperCase();
    // Simple hash to emoji mapping
    const emojis = ['🪙', '💰', '💎', '🚀', '⭐', '🔥', '💸', '🎯', '⚡', '🌟', '💫', '🔮'];
    let hash = 0;
    for (let i = 0; i < symbols.length; i++) {
      hash = ((hash << 5) - hash + symbols.charCodeAt(i)) & 0xffffffff;
    }
    return emojis[Math.abs(hash) % emojis.length];
  };
  
  onMount(() => {
    // Reset error state when src changes
    setImageError(false);
    setImageLoaded(false);
  });
  
  return (
    <div class={`${sizeClass()} flex items-center justify-center bg-bg-secondary border border-border overflow-hidden ${props.class || ''}`}>
      <Show when={props.src && !imageError()}>
        <img
          src={props.src!}
          alt={`${props.symbol} token`}
          class={`${sizeClass()} object-cover transition-opacity ${imageLoaded() ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageError(true);
            setImageLoaded(false);
          }}
        />
      </Show>
      
      <Show when={!props.src || imageError() || !imageLoaded()}>
        <div class={`${sizeClass()} flex items-center justify-center text-text-primary bg-bg-secondary`}>
          <span class={`${size() === 'sm' ? 'text-xs' : size() === 'lg' ? 'text-2xl' : 'text-lg'}`}>
            {getFallbackEmoji(props.symbol)}
          </span>
        </div>
      </Show>
    </div>
  );
}