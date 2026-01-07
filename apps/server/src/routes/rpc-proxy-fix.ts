// Example fix for the Hono TypeScript error with c.json()

import { Hono, Context } from 'hono';

// The error occurs because Hono's c.json() expects specific status codes
// Here are the correct ways to use it:

// Option 1: Use status code as a separate parameter with proper typing
export function sendJsonRpcError(c: Context, error: any, id: any) {
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: error.code,
        message: error.message
      },
      id: id
    },
    500 as any  // Cast to any if needed
  );
}

// Option 2: Use the status() method separately
export function sendJsonRpcError2(c: Context, error: any, id: any) {
  c.status(500);
  return c.json({
    jsonrpc: "2.0",
    error: {
      code: error.code,
      message: error.message
    },
    id: id
  });
}

// Option 3: Use proper Hono status codes
export function sendJsonRpcError3(c: Context, error: any, id: any) {
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: error.code,
        message: error.message
      },
      id: id
    },
    { status: 500 }  // Use object notation
  );
}

// If the issue is with a direct number being passed, wrap it:
export function fixJsonResponse(c: Context, data: any, statusCode: number) {
  // For Hono v4+
  return c.json(data, statusCode as any);
  
  // Or use the status method first
  // c.status(statusCode);
  // return c.json(data);
}