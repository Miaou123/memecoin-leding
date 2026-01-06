import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getIp } from './trustedProxy.js';

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
  const ip = getIp(c);
  
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
          requestId: c.get('requestId'),
        },
        source: 'auth-middleware',
        ip,
      });
      throw new Error('Invalid public key format');
    }
    
    // Validate timestamp is within 5 minutes
    const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes
    const timestampNum = parseInt(timestamp || '0', 10);
    const now = Date.now();
    
    if (!timestampNum || Math.abs(now - timestampNum) > MAX_TIMESTAMP_AGE_MS) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Authentication',
        eventType: 'AUTH_TIMESTAMP_EXPIRED',
        message: 'Request signature expired or invalid timestamp',
        details: {
          providedTimestamp: timestampNum,
          serverTime: now,
          diffMs: Math.abs(now - timestampNum),
          maxAgeMs: MAX_TIMESTAMP_AGE_MS,
          path: c.req.path,
        },
        source: 'auth-middleware',
        ip,
      });
      
      if (c.req.path.startsWith('/api/admin') || c.req.path.includes('/loans')) {
        throw new HTTPException(401, { message: 'Request expired' });
      }
    }
    
    // Verify signature cryptographically
    const message = `Sign in to Memecoin Lending Protocol\nTimestamp: ${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);
    
    // Decode base58 signature
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = bs58.decode(signature);
    } catch {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Authentication',
        eventType: SECURITY_EVENT_TYPES.AUTH_SIGNATURE_INVALID,
        message: 'Invalid signature format (not valid base58)',
        details: {
          publicKey: publicKey.substring(0, 8) + '...',
          path: c.req.path,
          method: c.req.method,
          userAgent,
        },
        source: 'auth-middleware',
        ip,
        userId: publicKey,
      });
      throw new Error('Invalid signature format');
    }
    
    // Get public key bytes
    const publicKeyBytes = new PublicKey(publicKey).toBytes();
    
    // Verify the signature using Ed25519
    const isValidSignature = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );
    
    if (!isValidSignature) {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Authentication',
        eventType: SECURITY_EVENT_TYPES.AUTH_SIGNATURE_INVALID,
        message: 'Cryptographic signature verification failed',
        details: {
          publicKey: publicKey.substring(0, 8) + '...',
          path: c.req.path,
          method: c.req.method,
          userAgent,
        },
        source: 'auth-middleware',
        ip,
        userId: publicKey,
      });
      throw new Error('Invalid signature');
    }
    
    // Only after successful verification, set the user context
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
    const ip = getIp(c);
    
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
  
  const ip = getIp(c);
  
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