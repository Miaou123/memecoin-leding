import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { PublicKey } from '@solana/web3.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

export interface AuthUser {
  wallet: string;
  isAdmin?: boolean;
}

declare module 'hono' {
  interface Context {
    user?: AuthUser;
  }
}

// Optional auth - sets user if valid signature provided
export const authMiddleware = async (c: Context, next: Next) => {
  const signature = c.req.header('X-Signature');
  const publicKey = c.req.header('X-Public-Key');
  const timestamp = c.req.header('X-Timestamp');
  const userAgent = c.req.header('User-Agent') || 'unknown';
  const ip = c.req.header('CF-Connecting-IP') || 
            c.req.header('X-Forwarded-For') || 
            c.req.header('X-Real-IP') || 
            'unknown';
  
  // SECURITY: Log missing authentication headers
  if (!signature || !publicKey || !timestamp) {
    if (c.req.path.startsWith('/admin/') || c.req.path.startsWith('/api/')) {
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Authentication',
        eventType: SECURITY_EVENT_TYPES.AUTH_MISSING_HEADERS,
        message: 'Authentication attempted with missing headers',
        details: {
          path: c.req.path,
          method: c.req.method,
          hasSignature: !!signature,
          hasPublicKey: !!publicKey,
          hasTimestamp: !!timestamp,
          userAgent,
        },
        source: 'auth-middleware',
        ip,
      });
    }
    return next();
  }
  
  try {
    // Validate public key format
    try {
      new PublicKey(publicKey);
    } catch {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Authentication',
        eventType: SECURITY_EVENT_TYPES.AUTH_SIGNATURE_INVALID,
        message: 'Invalid public key format in authentication',
        details: {
          publicKey: publicKey.substring(0, 8) + '...',
          path: c.req.path,
          userAgent,
        },
        source: 'auth-middleware',
        ip,
      });
      throw new Error('Invalid public key format');
    }
    
    // Check timestamp is within 5 minutes
    const now = Date.now();
    const signatureTime = parseInt(timestamp);
    
    if (isNaN(signatureTime)) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Authentication',
        eventType: SECURITY_EVENT_TYPES.AUTH_SIGNATURE_INVALID,
        message: 'Invalid timestamp format in authentication',
        details: {
          timestamp,
          publicKey: publicKey.substring(0, 8) + '...',
          path: c.req.path,
          userAgent,
        },
        source: 'auth-middleware',
        ip,
        userId: publicKey,
      });
      throw new Error('Invalid timestamp format');
    }
    
    const timeDiff = Math.abs(now - signatureTime);
    if (timeDiff > 5 * 60 * 1000) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Authentication',
        eventType: SECURITY_EVENT_TYPES.AUTH_SIGNATURE_EXPIRED,
        message: `Authentication signature expired by ${Math.round(timeDiff / 1000)}s`,
        details: {
          timeDiff: Math.round(timeDiff / 1000),
          maxAge: 300, // 5 minutes
          publicKey: publicKey.substring(0, 8) + '...',
          path: c.req.path,
          userAgent,
        },
        source: 'auth-middleware',
        ip,
        userId: publicKey,
      });
      throw new Error('Signature expired');
    }
    
    // Verify signature
    const message = `Sign in to Memecoin Lending Protocol\nTimestamp: ${timestamp}`;
    
    // For now, just validate the format - in production you'd verify the signature
    if (signature && publicKey) {
      const isAdmin = publicKey === process.env.ADMIN_WALLET;
      
      // SECURITY: Log admin access attempts
      if (isAdmin) {
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Authentication',
          eventType: SECURITY_EVENT_TYPES.AUTH_ADMIN_ACCESS,
          message: 'Admin authentication successful',
          details: {
            path: c.req.path,
            method: c.req.method,
            userAgent,
          },
          source: 'auth-middleware',
          ip,
          userId: publicKey,
        });
      }
      
      // Set user context
      c.user = {
        wallet: publicKey,
        isAdmin,
      };
    }
  } catch (error: any) {
    console.error('Auth error:', error);
    
    // SECURITY: Log general authentication failures
    await securityMonitor.log({
      severity: 'MEDIUM',
      category: 'Authentication',
      eventType: SECURITY_EVENT_TYPES.AUTH_SIGNATURE_INVALID,
      message: `Authentication failed: ${error.message}`,
      details: {
        error: error.message,
        publicKey: publicKey ? publicKey.substring(0, 8) + '...' : 'none',
        path: c.req.path,
        userAgent,
      },
      source: 'auth-middleware',
      ip,
      userId: publicKey || undefined,
    });
  }
  
  return next();
};

// Required auth - throws if not authenticated
export const requireAuth = async (c: Context, next: Next) => {
  await authMiddleware(c, next);
  
  if (!c.user) {
    const ip = c.req.header('CF-Connecting-IP') || 
              c.req.header('X-Forwarded-For') || 
              c.req.header('X-Real-IP') || 
              'unknown';
    
    // SECURITY: Log failed authentication attempts
    await securityMonitor.log({
      severity: 'MEDIUM',
      category: 'Authentication',
      eventType: SECURITY_EVENT_TYPES.AUTH_UNAUTHORIZED,
      message: 'Access denied - authentication required',
      details: {
        path: c.req.path,
        method: c.req.method,
        userAgent: c.req.header('User-Agent') || 'unknown',
        hasAuthHeaders: !!(c.req.header('X-Signature') && c.req.header('X-Public-Key')),
      },
      source: 'auth-middleware',
      ip,
    });
    
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  
  return next();
};

// Required admin auth
export const requireAdmin = async (c: Context, next: Next) => {
  await authMiddleware(c, next);
  
  const ip = c.req.header('CF-Connecting-IP') || 
            c.req.header('X-Forwarded-For') || 
            c.req.header('X-Real-IP') || 
            'unknown';
  
  if (!c.user?.isAdmin) {
    const severity = c.user ? 'HIGH' : 'MEDIUM'; // Higher severity if authenticated user tries admin access
    
    // SECURITY: Log admin impersonation attempts
    await securityMonitor.log({
      severity: severity as any,
      category: 'Authentication',
      eventType: c.user ? SECURITY_EVENT_TYPES.AUTH_ADMIN_IMPERSONATION : SECURITY_EVENT_TYPES.AUTH_UNAUTHORIZED,
      message: c.user 
        ? `Non-admin user attempted admin access: ${c.user.wallet.substring(0, 8)}...`
        : 'Unauthenticated admin access attempt',
      details: {
        path: c.req.path,
        method: c.req.method,
        userAgent: c.req.header('User-Agent') || 'unknown',
        userWallet: c.user?.wallet,
        isAuthenticated: !!c.user,
      },
      source: 'auth-middleware',
      ip,
      userId: c.user?.wallet,
    });
    
    throw new HTTPException(403, { message: 'Admin access required' });
  }
  
  return next();
};