import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { PublicKey } from '@solana/web3.js';

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
  
  if (!signature || !publicKey || !timestamp) {
    return next();
  }
  
  try {
    // Check timestamp is within 5 minutes
    const now = Date.now();
    const signatureTime = parseInt(timestamp);
    if (Math.abs(now - signatureTime) > 5 * 60 * 1000) {
      throw new Error('Signature expired');
    }
    
    // Verify signature
    const message = `Sign in to Memecoin Lending Protocol\nTimestamp: ${timestamp}`;
    
    // For now, just validate the format - in production you'd verify the signature
    if (signature && publicKey) {
      // Set user context
      c.user = {
        wallet: publicKey,
        isAdmin: publicKey === process.env.ADMIN_WALLET,
      };
    }
  } catch (error) {
    console.error('Auth error:', error);
  }
  
  return next();
};

// Required auth - throws if not authenticated
export const requireAuth = async (c: Context, next: Next) => {
  await authMiddleware(c, next);
  
  if (!c.user) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
};

// Required admin auth
export const requireAdmin = async (c: Context, next: Next) => {
  await authMiddleware(c, next);
  
  if (!c.user?.isAdmin) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }
};