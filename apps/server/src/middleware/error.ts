import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES, SecuritySeverity, SecurityCategory } from '@memecoin-lending/types';
import { getIp } from './trustedProxy.js';
import { getRequestId } from './requestId.js';
import { 
  sanitizeErrorMessage, 
  sanitizeErrorForLogging, 
  createSafeErrorResponse,
  mapPrismaError,
} from '../utils/errorSanitizer.js';

interface ErrorClassification {
  severity: SecuritySeverity;
  category: SecurityCategory;
  eventType: string;
}

function classifyError(err: Error): ErrorClassification {
  const message = err.message.toLowerCase();
  const errorName = err.constructor.name.toLowerCase();
  
  // Database errors - CRITICAL
  if (message.includes('prisma') || message.includes('database') || 
      errorName.includes('prisma') || message.includes('connection refused')) {
    return {
      severity: 'CRITICAL',
      category: 'Database',
      eventType: SECURITY_EVENT_TYPES.DATABASE_ERROR || 'DATABASE_ERROR',
    };
  }
  
  // Timeout errors - HIGH  
  if (message.includes('timeout') || message.includes('etimedout')) {
    return {
      severity: 'HIGH',
      category: 'Database',
      eventType: 'DB_QUERY_TIMEOUT',
    };
  }
  
  // Redis errors - HIGH  
  if (message.includes('redis') || message.includes('econnrefused')) {
    return {
      severity: 'HIGH',
      category: 'External Services',
      eventType: SECURITY_EVENT_TYPES.REDIS_ERROR,
    };
  }
  
  // Solana RPC errors - HIGH
  if (message.includes('rpc') || message.includes('solana') || message.includes('blockhash')) {
    return {
      severity: 'HIGH',
      category: 'External Services', 
      eventType: SECURITY_EVENT_TYPES.SOLANA_RPC_ERROR,
    };
  }
  
  // Jupiter/External API errors - MEDIUM
  if (message.includes('jupiter') || message.includes('jup.ag')) {
    return {
      severity: 'MEDIUM',
      category: 'External Services',
      eventType: SECURITY_EVENT_TYPES.JUPITER_API_ERROR,
    };
  }
  
  // Validation errors - LOW
  if (err instanceof ZodError || message.includes('validation') || message.includes('invalid')) {
    return {
      severity: 'LOW',
      category: 'Validation',
      eventType: 'VALIDATION_ERROR',
    };
  }
  
  // Default
  return {
    severity: 'MEDIUM',
    category: 'External Services',
    eventType: 'UNHANDLED_ERROR',
  };
}

export const errorHandler = async (err: Error, c: Context) => {
  const ip = getIp(c);
  const requestId = getRequestId(c);
  
  // Log full error internally (with secret redaction)
  const sanitizedForLog = sanitizeErrorForLogging(err);
  console.error('Error:', {
    requestId,
    path: c.req.path,
    method: c.req.method,
    ip,
    error: sanitizedForLog,
  });

  // Security logging for server errors and auth failures
  const shouldLogSecurity = 
    !(err instanceof HTTPException && err.status < 500) || 
    (err instanceof HTTPException && (err.status === 401 || err.status === 403));

  if (shouldLogSecurity) {
    const classification = classifyError(err);
    
    await securityMonitor.log({
      severity: classification.severity,
      category: classification.category,
      eventType: classification.eventType,
      message: `Error: ${sanitizedForLog.message.substring(0, 200)}`,
      details: {
        path: c.req.path,
        method: c.req.method,
        errorName: err.constructor.name,
        requestId,
      },
      source: 'global-error-handler',
      ip,
      requestId,
      userId: (c as any).user?.wallet,
    });
  }

  // Handle HTTPException (Hono's HTTP errors)
  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: sanitizeErrorMessage(err.message),
      requestId,
      statusCode: err.status,
    }, err.status);
  }

  // Handle Zod validation errors (safe to expose details)
  if (err instanceof ZodError) {
    return c.json({
      success: false,
      error: 'Validation Error',
      details: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
      requestId,
      statusCode: 400,
    }, 400);
  }

  // Handle Prisma errors - map to safe messages
  if (err.constructor.name.includes('Prisma')) {
    const { message, status } = mapPrismaError(err as any);
    return c.json({
      success: false,
      error: message,
      requestId,
      statusCode: status,
    }, status as any);
  }

  // Default: return sanitized error
  return c.json(createSafeErrorResponse(err, requestId, 500), 500);
};