import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import Redis from 'ioredis';
import { getIp } from './trustedProxy.js';
import { getEnhancedRateLimitService } from '../services/enhanced-rate-limit.service.js';

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

// Export for testing purposes - allows resetting the service
export function resetRateLimitService() {
  rateLimitService = null;
}

interface EnhancedRateLimitOptions {
  requests: number;
  windowMs: number;
  keyGenerator?: (c: Context) => string;
  name?: string; // For logging purposes
  useWalletIfAuthenticated?: boolean; // Use wallet-based limiting for authenticated requests
}

/**
 * Enhanced rate limiter middleware that combines all layers
 */
export const enhancedRateLimiter = (options: EnhancedRateLimitOptions) => {
  const { 
    requests, 
    windowMs, 
    keyGenerator, 
    name,
    useWalletIfAuthenticated = true 
  } = options;
  
  return async (c: Context, next: Next) => {
    const ip = getIp(c);
    const wallet = (c as any).user?.wallet;
    const isAuthenticated = !!wallet;
    
    try {
      let result;
      
      // Get rate limit service lazily
      const service = getRateLimitService();
      
      // Layer 4: Check ban status first
      if (isAuthenticated && useWalletIfAuthenticated) {
        // For authenticated endpoints, check wallet ban
        const walletBanCheck = await service.checkBanStatus(wallet, 'wallet');
        if (!walletBanCheck.allowed) {
          setRateLimitHeaders(c, walletBanCheck);
          throw new HTTPException(429, { 
            message: walletBanCheck.reason || 'Too many requests, please try again later'
          });
        }
      } else {
        // For unauthenticated endpoints, check IP ban
        const ipBanCheck = await service.checkBanStatus(ip, 'ip');
        if (!ipBanCheck.allowed) {
          setRateLimitHeaders(c, ipBanCheck);
          throw new HTTPException(429, { 
            message: ipBanCheck.reason || 'Too many requests, please try again later'
          });
        }
      }
      
      // Layer 2/3: Check appropriate rate limit
      if (isAuthenticated && useWalletIfAuthenticated) {
        // Use wallet-based rate limiting for authenticated endpoints
        result = await service.checkWalletRateLimit(wallet, ip);
      } else {
        // Use IP-based rate limiting for unauthenticated endpoints
        result = await service.checkIpRateLimit(ip);
      }
      
      // Set rate limit headers
      setRateLimitHeaders(c, result);
      
      if (!result.allowed) {
        throw new HTTPException(429, { 
          message: result.reason || 'Too many requests, please try again later'
        });
      }
      
      // Request allowed, proceed
      await next();
      
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error('Enhanced rate limit error:', error);
      // Fail open - don't block requests if rate limiting fails
      await next();
    }
  };
};

/**
 * Helper to set rate limit headers
 */
function setRateLimitHeaders(c: Context, result: any) {
  if (result.limit !== undefined) {
    c.header('X-RateLimit-Limit', result.limit.toString());
  }
  if (result.remaining !== undefined) {
    c.header('X-RateLimit-Remaining', result.remaining.toString());
  }
  if (result.reset) {
    c.header('X-RateLimit-Reset', result.reset.toISOString());
  }
  if (result.retryAfterMs) {
    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    c.header('Retry-After', retryAfterSeconds.toString());
  }
  if (result.limitType) {
    c.header('X-RateLimit-Type', result.limitType);
  }
}

// Legacy rate limiter wrapper for backward compatibility
export const rateLimiter = (options: {
  requests: number;
  windowMs: number;
  keyGenerator?: (c: Context) => string;
  name?: string;
}) => {
  return enhancedRateLimiter({
    ...options,
    useWalletIfAuthenticated: false // Legacy behavior: always use IP
  });
};

// Pre-configured rate limiters with enhanced functionality
export const apiRateLimit = enhancedRateLimiter({
  requests: 100,
  windowMs: 60 * 1000, // 1 minute
  name: 'api-general',
  useWalletIfAuthenticated: false // General API endpoints use IP-based limiting
});

export const strictRateLimit = enhancedRateLimiter({
  requests: 10,
  windowMs: 60 * 1000, // 1 minute
  name: 'api-strict',
  useWalletIfAuthenticated: false
});

export const createLoanRateLimit = enhancedRateLimiter({
  requests: 5,
  windowMs: 60 * 1000, // 1 minute
  name: 'create-loan',
  useWalletIfAuthenticated: true // Loan creation uses wallet-based limiting
});

export const adminRateLimit = enhancedRateLimiter({
  requests: 50,
  windowMs: 60 * 1000, // 1 minute
  name: 'admin-api',
  useWalletIfAuthenticated: true // Admin endpoints use wallet-based limiting
});

export const authRateLimit = enhancedRateLimiter({
  requests: 20,
  windowMs: 60 * 1000, // 1 minute
  name: 'authentication',
  useWalletIfAuthenticated: false // Auth endpoints use IP-based limiting
});

// New rate limiter for wallet-authenticated endpoints
export const walletRateLimit = enhancedRateLimiter({
  requests: 50,
  windowMs: 60 * 1000, // 1 minute
  name: 'wallet-api',
  useWalletIfAuthenticated: true // Force wallet-based limiting
});

/**
 * Custom rate limiter factory for specific needs
 */
export function createCustomRateLimit(config: {
  requests: number;
  windowMs: number;
  name: string;
  useWalletIfAuthenticated?: boolean;
}) {
  return enhancedRateLimiter(config);
}