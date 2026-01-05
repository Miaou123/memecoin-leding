import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getIp } from './trustedProxy.js';
import crypto from 'crypto';

interface CsrfConfig {
  /** Cookie name for CSRF token */
  cookieName?: string;
  /** Header name for CSRF token */
  headerName?: string;
  /** Allowed origins (for origin-based validation) */
  allowedOrigins?: string[];
  /** Skip CSRF check for these paths */
  skipPaths?: string[];
  /** Skip CSRF for requests with valid wallet signatures */
  skipIfSignatureAuth?: boolean;
}

const DEFAULT_CONFIG: CsrfConfig = {
  cookieName: 'csrf-token',
  headerName: 'X-CSRF-Token',
  allowedOrigins: [],
  skipPaths: ['/health', '/ready', '/metrics'],
  skipIfSignatureAuth: true, // Wallet signatures provide replay protection
};

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF protection middleware
 * 
 * Uses a combination of:
 * 1. Origin/Referer header validation
 * 2. Custom CSRF token in header (for non-browser clients)
 * 3. Double-submit cookie pattern
 */
export const csrfMiddleware = (config: CsrfConfig = {}) => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const { cookieName, headerName, allowedOrigins, skipPaths, skipIfSignatureAuth } = mergedConfig;
  
  return async (c: Context, next: Next) => {
    const method = c.req.method.toUpperCase();
    
    // Only check CSRF for state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }
    
    // Skip for configured paths
    const path = c.req.path;
    if (skipPaths?.some(p => path.startsWith(p))) {
      return next();
    }
    
    // Skip if request has valid wallet signature (signatures are per-request)
    if (skipIfSignatureAuth) {
      const signature = c.req.header('X-Signature');
      const publicKey = c.req.header('X-Public-Key');
      const timestamp = c.req.header('X-Timestamp');
      
      // If all auth headers are present, signature verification will handle security
      if (signature && publicKey && timestamp) {
        return next();
      }
    }
    
    const ip = getIp(c);
    
    // Check 1: Origin header validation
    const origin = c.req.header('Origin');
    const referer = c.req.header('Referer');
    
    if (origin) {
      const allowedOriginsEnv = process.env.CORS_ORIGIN?.split(',') || [];
      const allAllowedOrigins = [...(allowedOrigins || []), ...allowedOriginsEnv];
      
      if (allAllowedOrigins.length > 0 && !allAllowedOrigins.includes(origin)) {
        await securityMonitor.log({
          severity: 'HIGH',
          category: 'Validation',
          eventType: SECURITY_EVENT_TYPES.CSRF_ORIGIN_MISMATCH,
          message: `CSRF validation failed: origin mismatch`,
          details: {
            origin,
            allowedOrigins: allAllowedOrigins,
            path,
            method,
          },
          source: 'csrf-middleware',
          ip,
        });
        
        throw new HTTPException(403, { message: 'CSRF validation failed: invalid origin' });
      }
    }
    
    // Check 2: For requests without Origin header, check Referer
    if (!origin && referer) {
      try {
        const refererUrl = new URL(referer);
        const allowedOriginsEnv = process.env.CORS_ORIGIN?.split(',') || [];
        const allAllowedOrigins = [...(allowedOrigins || []), ...allowedOriginsEnv];
        
        const refererOrigin = refererUrl.origin;
        if (allAllowedOrigins.length > 0 && !allAllowedOrigins.includes(refererOrigin)) {
          await securityMonitor.log({
            severity: 'HIGH',
            category: 'Validation',
            eventType: SECURITY_EVENT_TYPES.CSRF_REFERER_MISMATCH,
            message: `CSRF validation failed: referer mismatch`,
            details: {
              referer: refererOrigin,
              allowedOrigins: allAllowedOrigins,
              path,
              method,
            },
            source: 'csrf-middleware',
            ip,
          });
          
          throw new HTTPException(403, { message: 'CSRF validation failed: invalid referer' });
        }
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        // Invalid referer URL - could be an attack
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Validation',
          eventType: SECURITY_EVENT_TYPES.CSRF_INVALID_REFERER,
          message: `CSRF validation: invalid referer URL`,
          details: {
            referer,
            path,
            method,
          },
          source: 'csrf-middleware',
          ip,
        });
      }
    }
    
    // Check 3: CSRF token validation (double-submit cookie pattern)
    // This is optional for API-only backends but adds defense in depth
    const csrfCookie = c.req.header('Cookie')
      ?.split(';')
      .find(c => c.trim().startsWith(`${cookieName}=`))
      ?.split('=')[1];
    
    const csrfHeader = c.req.header(headerName!);
    
    // If CSRF cookie is set, header must match
    if (csrfCookie && csrfHeader && csrfCookie !== csrfHeader) {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Validation',
        eventType: SECURITY_EVENT_TYPES.CSRF_TOKEN_MISMATCH,
        message: `CSRF validation failed: token mismatch`,
        details: {
          path,
          method,
          hasCookie: !!csrfCookie,
          hasHeader: !!csrfHeader,
        },
        source: 'csrf-middleware',
        ip,
      });
      
      throw new HTTPException(403, { message: 'CSRF validation failed: token mismatch' });
    }
    
    await next();
  };
};

/**
 * Endpoint to get a new CSRF token (for SPAs)
 */
export const csrfTokenEndpoint = async (c: Context) => {
  const token = generateCsrfToken();
  
  // Set cookie with secure flags
  const isProduction = process.env.NODE_ENV === 'production';
  c.header(
    'Set-Cookie',
    `csrf-token=${token}; Path=/; HttpOnly; SameSite=Strict${isProduction ? '; Secure' : ''}`
  );
  
  return c.json({ token });
};

// Export pre-configured middleware
export const csrfProtection = csrfMiddleware();