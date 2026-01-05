import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import Redis from 'ioredis';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getIp } from './trustedProxy.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// SECURITY: Track rate limit violations per IP for pattern detection
const violationTracker = new Map<string, number[]>();
const SUSPICIOUS_THRESHOLD = 10; // 10 violations in 5 minutes = suspicious
const TRACKING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface RateLimitOptions {
  requests: number;
  windowMs: number;
  keyGenerator?: (c: Context) => string;
  name?: string; // For logging purposes
}

// Helper to clean old violations and return recent ones
function cleanOldViolations(ip: string): number[] {
  const violations = violationTracker.get(ip) || [];
  const cutoff = Date.now() - TRACKING_WINDOW_MS;
  const recent = violations.filter(t => t > cutoff);
  violationTracker.set(ip, recent);
  return recent;
}

export const rateLimiter = (options: RateLimitOptions) => {
  const { requests, windowMs, keyGenerator, name } = options;
  
  return async (c: Context, next: Next) => {
    const ip = getIp(c);
               
    const key = keyGenerator 
      ? keyGenerator(c) 
      : `rate-limit:${ip}`;
    
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
        
        // SECURITY: Track this violation
        const recentViolations = cleanOldViolations(ip);
        recentViolations.push(Date.now());
        violationTracker.set(ip, recentViolations);
        
        // SECURITY: Log the rate limit violation
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Rate Limiting',
          eventType: SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED,
          message: `Rate limit exceeded for ${ip}`,
          details: {
            ip,
            path: c.req.path,
            method: c.req.method,
            limitName: name || 'unknown',
            limit: requests,
            window: Math.round(windowMs / 1000),
            currentCount: current,
            recentViolations: recentViolations.length,
            userAgent: c.req.header('User-Agent')?.slice(0, 100),
            userId: (c as any).user?.wallet,
          },
          source: 'rate-limit-middleware',
          ip,
          userId: (c as any).user?.wallet,
        });
        
        // SECURITY: Check for suspicious pattern
        if (recentViolations.length >= SUSPICIOUS_THRESHOLD) {
          await securityMonitor.log({
            severity: 'HIGH',
            category: 'Rate Limiting',
            eventType: SECURITY_EVENT_TYPES.RATE_LIMIT_SUSPICIOUS,
            message: `Suspicious rate limit pattern from ${ip}: ${recentViolations.length} violations in 5 minutes`,
            details: {
              ip,
              violationsInWindow: recentViolations.length,
              threshold: SUSPICIOUS_THRESHOLD,
              windowMinutes: 5,
              limitName: name || 'unknown',
              userAgent: c.req.header('User-Agent')?.slice(0, 100),
              isAuthenticated: !!(c as any).user?.wallet,
              userId: (c as any).user?.wallet,
            },
            source: 'rate-limit-middleware',
            ip,
            userId: (c as any).user?.wallet,
          });
        }
        
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

// Pre-configured rate limiters with security logging
export const apiRateLimit = rateLimiter({
  requests: 100,
  windowMs: 60 * 1000, // 1 minute
  name: 'api-general',
});

export const strictRateLimit = rateLimiter({
  requests: 10,
  windowMs: 60 * 1000, // 1 minute
  name: 'api-strict',
});

export const createLoanRateLimit = rateLimiter({
  requests: 5,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: (c) => `create-loan:${(c as any).user?.wallet || 'anonymous'}`,
  name: 'create-loan',
});

export const adminRateLimit = rateLimiter({
  requests: 50,
  windowMs: 60 * 1000, // 1 minute
  keyGenerator: (c) => `admin:${(c as any).user?.wallet || 'anonymous'}`,
  name: 'admin-api',
});

export const authRateLimit = rateLimiter({
  requests: 20,
  windowMs: 60 * 1000, // 1 minute
  name: 'authentication',
});