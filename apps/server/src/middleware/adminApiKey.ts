import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Admin API key authentication middleware
 * Checks for X-Admin-Key header against ADMIN_API_KEY env var
 */
export const requireAdminApiKey = async (c: Context, next: Next) => {
  const providedKey = c.req.header('X-Admin-Key');
  const expectedKey = process.env.ADMIN_API_KEY;
  
  if (!expectedKey) {
    console.error('⚠️ ADMIN_API_KEY not configured');
    throw new HTTPException(500, { message: 'Admin authentication not configured' });
  }
  
  if (!providedKey || providedKey !== expectedKey) {
    throw new HTTPException(403, { message: 'Invalid admin API key' });
  }
  
  return next();
};