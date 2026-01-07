import { Context, Next } from 'hono';
import Redis from 'ioredis';
import { getEnhancedRateLimitService } from '../services/enhanced-rate-limit.service.js';

// Initialize Redis connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

// Lazy initialization of rate limit service for better testability
let rateLimitService: ReturnType<typeof getEnhancedRateLimitService> | null = null;

function getRateLimitService() {
  if (!rateLimitService) {
    rateLimitService = getEnhancedRateLimitService(redis);
  }
  return rateLimitService;
}

/**
 * Global rate limit middleware - protects the entire protocol
 * This should be the FIRST middleware applied to prevent DDoS
 */
export async function globalRateLimitMiddleware(c: Context, next: Next) {
  try {
    // Check global rate limit
    const result = await getRateLimitService().checkGlobalRateLimit();
    
    // Set rate limit headers
    if (result.limit && result.reset) {
      c.header('X-RateLimit-Limit', result.limit.toString());
      c.header('X-RateLimit-Remaining', (result.remaining || 0).toString());
      c.header('X-RateLimit-Reset', result.reset.toISOString());
      c.header('X-RateLimit-Type', 'global');
    }
    
    if (!result.allowed) {
      // Calculate retry after in seconds
      const retryAfterSeconds = Math.ceil((result.retryAfterMs || 60000) / 1000);
      c.header('Retry-After', retryAfterSeconds.toString());
      
      return c.json({
        success: false,
        error: 'Service Unavailable',
        message: result.reason || 'Global rate limit exceeded. Please try again later.',
        retryAfter: retryAfterSeconds,
        limitType: 'global'
      }, 503);
    }
    
    // Request allowed, proceed
    await next();
    
  } catch (error) {
    console.error('Global rate limit middleware error:', error);
    // Fail open - don't block requests if rate limiting fails
    await next();
  }
}

/**
 * Factory function to create a global rate limit middleware with custom config
 */
export function createGlobalRateLimitMiddleware(config?: {
  globalLimit?: number;
  globalWindowMs?: number;
}) {
  // Create a new service instance with custom config
  const customService = getEnhancedRateLimitService(redis, config);
  
  return async (c: Context, next: Next) => {
    try {
      const result = await customService.checkGlobalRateLimit();
      
      if (result.limit && result.reset) {
        c.header('X-RateLimit-Limit', result.limit.toString());
        c.header('X-RateLimit-Remaining', (result.remaining || 0).toString());
        c.header('X-RateLimit-Reset', result.reset.toISOString());
        c.header('X-RateLimit-Type', 'global');
      }
      
      if (!result.allowed) {
        const retryAfterSeconds = Math.ceil((result.retryAfterMs || 60000) / 1000);
        c.header('Retry-After', retryAfterSeconds.toString());
        
        return c.json({
          success: false,
          error: 'Service Unavailable',
          message: result.reason || 'Global rate limit exceeded. Please try again later.',
          retryAfter: retryAfterSeconds,
          limitType: 'global'
        }, 503);
      }
      
      await next();
    } catch (error) {
      console.error('Global rate limit middleware error:', error);
      await next();
    }
  };
}