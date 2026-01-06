/**
 * Error sanitization utilities
 * Prevents information leakage in error responses
 */

// Patterns that indicate sensitive information
const SENSITIVE_PATTERNS: RegExp[] = [
  // File paths
  /\/home\/[^\s"']+/gi,
  /\/var\/[^\s"']+/gi,
  /\/etc\/[^\s"']+/gi,
  /\/usr\/[^\s"']+/gi,
  /[A-Z]:\\[^\s"']+/gi,  // Windows paths
  /\.ts:\d+:\d+/gi,      // TypeScript file:line:col
  /\.js:\d+:\d+/gi,      // JavaScript file:line:col
  
  // API keys and secrets
  /api[_-]?key[=:]\s*['"]?[a-zA-Z0-9_-]{16,}['"]?/gi,
  /secret[=:]\s*['"]?[a-zA-Z0-9_-]{16,}['"]?/gi,
  /password[=:]\s*['"]?[^\s'"]{4,}['"]?/gi,
  /bearer\s+[a-zA-Z0-9._-]+/gi,
  /token[=:]\s*['"]?[a-zA-Z0-9._-]{20,}['"]?/gi,
  
  // Database connection strings
  /postgresql:\/\/[^\s"']+/gi,
  /postgres:\/\/[^\s"']+/gi,
  /mysql:\/\/[^\s"']+/gi,
  /mongodb(\+srv)?:\/\/[^\s"']+/gi,
  /redis:\/\/[^\s"']+/gi,
  
  // Internal IP addresses
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/g,
  
  // Solana private keys (base58, ~87-88 chars)
  /[1-9A-HJ-NP-Za-km-z]{85,90}/g,
  
  // Stack trace locations
  /at\s+[^\s]+\s+\([^)]+\)/g,
  /at\s+[^\s]+:[0-9]+:[0-9]+/g,
];

// Map internal errors to safe user-facing messages
const ERROR_MAPPINGS: Array<{ pattern: RegExp | string; message: string }> = [
  // Prisma/Database errors
  { pattern: /prisma/i, message: 'Database error occurred' },
  { pattern: /unique constraint/i, message: 'A record with this value already exists' },
  { pattern: /foreign key constraint/i, message: 'Invalid reference' },
  { pattern: /record.*not found/i, message: 'Resource not found' },
  { pattern: /connection refused/i, message: 'Service temporarily unavailable' },
  { pattern: /connection timeout/i, message: 'Service temporarily unavailable' },
  { pattern: /econnrefused/i, message: 'Service temporarily unavailable' },
  { pattern: /etimedout/i, message: 'Request timed out' },
  { pattern: /enotfound/i, message: 'Service temporarily unavailable' },
  
  // Solana errors
  { pattern: /blockhash not found/i, message: 'Transaction expired, please retry' },
  { pattern: /insufficient funds/i, message: 'Insufficient balance' },
  { pattern: /invalid account data/i, message: 'Invalid account state' },
  { pattern: /account not found/i, message: 'Account not found' },
  
  // Jupiter/Swap errors
  { pattern: /no route found/i, message: 'Unable to find swap route' },
  { pattern: /slippage.*exceeded/i, message: 'Price changed too much, please retry' },
  
  // Generic patterns
  { pattern: /invalid signature/i, message: 'Invalid signature' },
  { pattern: /unauthorized/i, message: 'Unauthorized' },
  { pattern: /forbidden/i, message: 'Access denied' },
];

/**
 * Sanitize an error message for safe external display
 */
export function sanitizeErrorMessage(message: string | undefined | null): string {
  if (!message) return 'An error occurred';
  
  const lowerMessage = message.toLowerCase();
  
  // Check for known error patterns and replace with safe messages
  for (const { pattern, message: safeMessage } of ERROR_MAPPINGS) {
    if (typeof pattern === 'string') {
      if (lowerMessage.includes(pattern.toLowerCase())) {
        return safeMessage;
      }
    } else if (pattern.test(message)) {
      return safeMessage;
    }
  }
  
  // Remove sensitive patterns
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  
  // If message still looks sensitive, genericize it
  const sensitiveIndicators = [
    '[REDACTED]',
    '/src/',
    '/dist/',
    'node_modules',
    'stack:',
    'Error:',
    '.prisma',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'FROM',
    'WHERE',
  ];
  
  if (sensitiveIndicators.some(indicator => sanitized.includes(indicator))) {
    return 'An error occurred processing your request';
  }
  
  // Truncate very long messages
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }
  
  return sanitized;
}

/**
 * Sanitize error for internal logging (keeps more detail but removes secrets)
 */
export function sanitizeErrorForLogging(error: Error): {
  name: string;
  message: string;
  stack?: string;
} {
  let stack = error.stack;
  
  // Only remove secrets from stack, keep file paths for debugging
  if (stack) {
    stack = stack
      .replace(/api[_-]?key[=:]\s*['"]?[a-zA-Z0-9_-]{16,}['"]?/gi, 'api_key=[REDACTED]')
      .replace(/password[=:]\s*['"]?[^\s'"]+['"]?/gi, 'password=[REDACTED]')
      .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
  }
  
  return {
    name: error.name,
    message: error.message, // Keep full message for internal logging
    stack: process.env.NODE_ENV === 'development' ? stack : undefined,
  };
}

/**
 * Create a safe error response for API clients
 */
export function createSafeErrorResponse(
  error: Error,
  requestId?: string,
  statusCode: number = 500
): {
  success: false;
  error: string;
  requestId?: string;
  statusCode: number;
  debug?: { message: string; stack?: string; name: string };
} {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const response: any = {
    success: false,
    error: sanitizeErrorMessage(error.message),
    statusCode,
  };
  
  if (requestId) {
    response.requestId = requestId;
  }
  
  // Only include debug info in development
  if (!isProduction) {
    response.debug = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  
  return response;
}

/**
 * Map Prisma error codes to safe responses
 */
export function mapPrismaError(error: any): { message: string; status: number } {
  const errorMap: Record<string, { message: string; status: number }> = {
    'P2002': { message: 'A record with this value already exists', status: 409 },
    'P2025': { message: 'Record not found', status: 404 },
    'P2003': { message: 'Invalid reference', status: 400 },
    'P2014': { message: 'Invalid data provided', status: 400 },
    'P2021': { message: 'Database table not found', status: 500 },
    'P2024': { message: 'Database operation timed out', status: 503 },
  };
  
  return errorMap[error.code] || { message: 'Database error occurred', status: 500 };
}