import { createSignal } from 'solid-js';

export function DurationSliderDemo() {
  const [duration, setDuration] = createSignal(48 * 60 * 60); // 48 hours default (base LTV)

  // Format duration for display in bubble
  const formatDurationDisplay = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    
    if (days === 0) {
      return `${hours}h`;
    } else if (remainingHours === 0) {
      return `${days}d`;
    } else {
      return `${days}d ${remainingHours}h`;
    }
  };

  return (
    <div class="p-6 bg-bg-secondary border border-border rounded-lg">
      <h3 class="text-lg font-bold mb-4">Duration Slider Demo</h3>
      
      {/* Duration Selection - Visual Timeline */}
      <div>
        <label class="block text-sm font-medium mb-4">Loan Duration</label>
        
        <div class="flex items-center gap-3">
          {/* Left label */}
          <span class="text-xs font-medium text-green-500 whitespace-nowrap">+25%</span>
          
          {/* Main bar container */}
          <div class="flex-1 relative">
            {/* Background bar with gradient zones */}
            <div class="h-12 rounded-lg flex overflow-hidden">
              {/* Bonus zone: 12h to 48h = 23.1% of total range */}
              <div 
                style="width: 23.1%;" 
                class="bg-gradient-to-r from-green-600/40 to-green-500/20 flex items-center justify-center border-r border-green-500/30"
              >
                <span class="text-[10px] text-green-400 font-medium">BONUS</span>
              </div>
              {/* Reduced zone: 48h to 168h = 76.9% */}
              <div 
                style="width: 76.9%;" 
                class="bg-gradient-to-r from-gray-600/20 to-red-500/30"
              />
            </div>
            
            {/* Invisible range slider */}
            <input
              type="range"
              min={12 * 60 * 60}
              max={7 * 24 * 60 * 60}
              step={60 * 60}
              value={duration()}
              onInput={(e) => setDuration(parseInt(e.currentTarget.value))}
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            {/* Position indicator (white bar with bubble) */}
            <div 
              class="absolute top-0 h-12 w-1 bg-white rounded shadow-lg pointer-events-none transition-all duration-75"
              style={`left: ${((duration() / 3600) - 12) / 156 * 100}%`}
            >
              <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-2 py-1 rounded font-bold whitespace-nowrap">
                {formatDurationDisplay(duration())}
              </div>
            </div>
            
            {/* Time markers */}
            <div class="relative h-6 mt-2">
              {[
                { label: '12h', hours: 12 },
                { label: '1d', hours: 24 },
                { label: '2d', hours: 48 },
                { label: '3d', hours: 72 },
                { label: '4d', hours: 96 },
                { label: '5d', hours: 120 },
                { label: '6d', hours: 144 },
                { label: '7d', hours: 168 },
              ].map(marker => (
                <button
                  onClick={() => setDuration(marker.hours * 60 * 60)}
                  class={`absolute text-xs transform -translate-x-1/2 transition-all hover:text-green-400 ${
                    Math.floor(duration() / 3600) === marker.hours
                      ? 'text-green-400 font-bold'
                      : 'text-gray-500'
                  }`}
                  style={`left: ${(marker.hours - 12) / 156 * 100}%`}
                >
                  {marker.label}
                </button>
              ))}
            </div>
          </div>
          
          {/* Right label */}
          <span class="text-xs font-medium text-red-500 whitespace-nowrap">-25%</span>
        </div>
      </div>
      
      {/* Current selection display */}
      <div class="mt-4 p-3 bg-bg-primary border border-border rounded">
        <div class="text-sm text-text-secondary">Selected Duration:</div>
        <div class="text-lg font-bold text-text-primary">{formatDurationDisplay(duration())}</div>
        <div class="text-xs text-text-dim">
          Hours: {Math.floor(duration() / 3600)} | Seconds: {duration()}
        </div>
      </div>
      
      {/* Instructions */}
      <div class="mt-3 text-xs text-text-dim">
        💡 Drag the timeline or click markers to adjust duration. Green zone = bonus LTV, red zone = reduced LTV.
      </div>
    </div>
  );
}