import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getIp } from './trustedProxy.js';

interface BodyLimitConfig {
  maxSize: number; // in bytes
  onError?: (c: Context) => Response | Promise<Response>;
}

const DEFAULT_MAX_SIZE = 1024 * 1024; // 1MB

/**
 * Body size limiting middleware
 * Prevents DoS attacks via large request bodies
 */
export const bodyLimitMiddleware = (config: BodyLimitConfig = { maxSize: DEFAULT_MAX_SIZE }) => {
  const { maxSize, onError } = config;
  
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header('Content-Length');
    
    // Check Content-Length header first (fast rejection)
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      
      if (!isNaN(length) && length > maxSize) {
        const ip = getIp(c);
        
        // Log the oversized request attempt
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Validation',
          eventType: SECURITY_EVENT_TYPES.REQUEST_TOO_LARGE || 'REQUEST_TOO_LARGE',
          message: `Request body too large: ${length} bytes (max: ${maxSize})`,
          details: {
            contentLength: length,
            maxSize,
            path: c.req.path,
            method: c.req.method,
            userAgent: c.req.header('User-Agent')?.slice(0, 100),
          },
          source: 'body-limit-middleware',
          ip,
        });
        
        if (onError) {
          return onError(c);
        }
        
        throw new HTTPException(413, {
          message: `Request body too large. Maximum size is ${Math.round(maxSize / 1024)}KB`,
        });
      }
    }
    
    // For streaming bodies without Content-Length, we need to check while reading
    // This is handled by Hono's built-in parsing, but we can add additional protection
    
    await next();
  };
};

// Pre-configured limits for different use cases
export const defaultBodyLimit = bodyLimitMiddleware({ maxSize: 1024 * 1024 }); // 1MB
export const smallBodyLimit = bodyLimitMiddleware({ maxSize: 100 * 1024 }); // 100KB
export const largeBodyLimit = bodyLimitMiddleware({ maxSize: 10 * 1024 * 1024 }); // 10MB

// Strict limit for auth endpoints (signatures are small)
export const authBodyLimit = bodyLimitMiddleware({ maxSize: 10 * 1024 }); // 10KB

// Export for custom configuration
export { DEFAULT_MAX_SIZE };