import { Hono } from 'hono';
import { getClientIp } from '../utils/clientIp.js';

const rpcProxyRouter = new Hono();

// Rate limiting map (simple in-memory, consider Redis for production)
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP

function checkRateLimit(clientIp: string): boolean {
  const now = Date.now();
  const userLimit = requestCounts.get(clientIp);
  
  if (!userLimit || now > userLimit.resetTime) {
    requestCounts.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, limit] of requestCounts.entries()) {
    if (now > limit.resetTime) {
      requestCounts.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

/**
 * Proxy RPC requests to Solana
 * This endpoint proxies requests to protect the API key
 */
rpcProxyRouter.post('/rpc', async (c) => {
  try {
    const clientIp = getClientIp(c);
    
    // Check rate limit
    if (!checkRateLimit(clientIp)) {
      return c.json(
        { 
          jsonrpc: '2.0', 
          error: { 
            code: -32003, 
            message: 'Rate limit exceeded. Please try again later.' 
          },
          id: null
        },
        429
      );
    }
    
    const body = await c.req.json();
    
    // Validate RPC request structure
    if (!body.jsonrpc || !body.method) {
      return c.json(
        { 
          jsonrpc: '2.0', 
          error: { 
            code: -32600, 
            message: 'Invalid Request' 
          },
          id: body.id || null
        },
        400
      );
    }
    
    const allowedMethods = [
      // Essential for wallet/connection
      'getAccountInfo',
      'getBalance',
      'getLatestBlockhash',
      'getBlockHeight',
      'getSlot',
      
      // Transaction handling
      'sendTransaction',
      'simulateTransaction',
      'getSignatureStatuses',
      'getSignaturesForAddress',
      'getTransaction',
      'getRecentPrioritizationFees',
      'getFeeForMessage',
      
      // Token operations
      'getTokenAccountBalance',
      'getTokenAccountsByOwner',
      'getTokenSupply',
      
      // Batch operations
      'getMultipleAccounts',
      
      // SDK needs this for .all() queries
      'getProgramAccounts',
      
      // Optional - for epoch/staking info
      'getEpochInfo',
      
      // Health check (useful for monitoring)
      'getHealth',
    ];
    
    if (!allowedMethods.includes(body.method)) {
      console.warn(`Blocked unauthorized RPC method: ${body.method} from IP: ${clientIp}`);
      return c.json(
        { 
          jsonrpc: '2.0', 
          error: { 
            code: -32601, 
            message: 'Method not allowed through proxy' 
          },
          id: body.id || null
        },
        403
      );
    }
    
    // Use backend RPC URL with API key
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      console.error('SOLANA_RPC_URL not configured');
      return c.json(
        { 
          jsonrpc: '2.0', 
          error: { 
            code: -32000, 
            message: 'RPC service unavailable' 
          },
          id: body.id || null
        },
        503
      );
    }
    
    // Forward the request
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add any additional headers your RPC provider requires
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (!response.ok) {
      console.error(`RPC request failed: ${response.status} ${response.statusText}`);
      return c.json(
        { 
          jsonrpc: '2.0', 
          error: { 
            code: -32000, 
            message: 'RPC request failed' 
          },
          id: body.id || null
        },
        response.status as 400 | 500 | 502 | 503 | 504
      );
    }
    
    const result = await response.json();
    return c.json(result);
    
  } catch (error) {
    console.error('RPC proxy error:', error);
    return c.json(
      { 
        jsonrpc: '2.0', 
        error: { 
          code: -32000, 
          message: error instanceof Error ? error.message : 'Internal proxy error' 
        },
        id: null
      },
      500
    );
  }
});

/**
 * Health check endpoint for the RPC proxy
 */
rpcProxyRouter.get('/health', async (c) => {
  const rpcConfigured = !!process.env.SOLANA_RPC_URL;
  const activeConnections = requestCounts.size;
  
  return c.json({
    healthy: rpcConfigured,
    rpcConfigured,
    activeRateLimitEntries: activeConnections,
    maxRequestsPerMinute: RATE_LIMIT_MAX_REQUESTS,
  });
});

export { rpcProxyRouter };