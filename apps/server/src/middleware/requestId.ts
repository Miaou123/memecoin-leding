import { Context, Next } from 'hono';
import { randomUUID } from 'crypto';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

/**
 * Middleware that assigns a unique ID to each request
 * - Uses client-provided X-Request-ID if present (for distributed tracing)
 * - Generates a new UUID if not provided
 * - Sets the ID in response headers for client reference
 */
export const requestIdMiddleware = async (c: Context, next: Next) => {
  // Use existing request ID from client or generate new one
  const requestId = c.req.header('X-Request-ID') || randomUUID();
  
  // Store in context for use throughout the request lifecycle
  c.set('requestId', requestId);
  
  // Set in response headers so client can reference it
  c.header('X-Request-ID', requestId);
  
  await next();
};

/**
 * Helper to get request ID from context
 */
export function getRequestId(c: Context): string {
  return c.get('requestId') || 'unknown';
}