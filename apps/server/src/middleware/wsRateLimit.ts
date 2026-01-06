/**
 * WebSocket message rate limiting
 */

interface RateLimitEntry {
  messages: number[];
  warnings: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

const WS_RATE_LIMIT = {
  messagesPerSecond: 20,
  messagesPerMinute: 200,
  maxWarnings: 3,
};

export function checkWsRateLimit(connectionId: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  let entry = rateLimits.get(connectionId);
  
  if (!entry) {
    entry = { messages: [], warnings: 0 };
    rateLimits.set(connectionId, entry);
  }
  
  // Clean old messages
  entry.messages = entry.messages.filter(t => now - t < 60000);
  
  // Check per-second limit
  const lastSecond = entry.messages.filter(t => now - t < 1000).length;
  if (lastSecond >= WS_RATE_LIMIT.messagesPerSecond) {
    entry.warnings++;
    if (entry.warnings >= WS_RATE_LIMIT.maxWarnings) {
      return { allowed: false, reason: 'Rate limit exceeded - connection terminated' };
    }
    return { allowed: false, reason: 'Too many messages per second' };
  }
  
  // Check per-minute limit
  if (entry.messages.length >= WS_RATE_LIMIT.messagesPerMinute) {
    entry.warnings++;
    if (entry.warnings >= WS_RATE_LIMIT.maxWarnings) {
      return { allowed: false, reason: 'Rate limit exceeded - connection terminated' };
    }
    return { allowed: false, reason: 'Too many messages per minute' };
  }
  
  entry.messages.push(now);
  return { allowed: true };
}

export function clearWsRateLimit(connectionId: string): void {
  rateLimits.delete(connectionId);
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of rateLimits.entries()) {
    if (entry.messages.every(t => now - t > 60000)) {
      rateLimits.delete(id);
    }
  }
}, 5 * 60 * 1000);