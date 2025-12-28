import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface RateLimitOptions {
  requests: number;
  windowMs: number;
  keyGenerator?: (c: Context) => string;
}

export const rateLimiter = (options: RateLimitOptions) => {
  const { requests, windowMs, keyGenerator } = options;
  
  return async (c: Context, next: Next) => {
    const key = keyGenerator 
      ? keyGenerator(c) 
      : `rate-limit:${c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'}`;
    
    try {
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      
      if (current > requests) {
        const ttl = await redis.ttl(key);
        c.header('X-RateLimit-Limit', requests.toString());
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());
        
        throw new HTTPException(429, { 
          message: 'Too many requests, please try again later' 
        });
      }
      
      c.header('X-RateLimit-Limit', requests.toString());
      c.header('X-RateLimit-Remaining', (requests - current).toString());
      
      return next();
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error('Rate limit error:', error);
      return next();
    }
  };
};

// Pre-configured rate limiters
export const apiRateLimit = rateLimiter({
  requests: 100,
  windowMs: 60 * 1000, // 1 minute
});

export const strictRateLimit = rateLimiter({
  requests: 10,
  windowMs: 60 * 1000, // 1 minute
});

export const createLoanRateLimit = rateLimiter({
  requests: 5,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: (c) => `create-loan:${c.user?.wallet || 'anonymous'}`,
});