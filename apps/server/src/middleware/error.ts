import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES, SecuritySeverity, SecurityCategory } from '@memecoin-lending/types';

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
      eventType: SECURITY_EVENT_TYPES.DATABASE_ERROR,
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
  if (err instanceof ZodError || message.includes('validation') || message.includes('required')) {
    return {
      severity: 'LOW',
      category: 'Validation',
      eventType: SECURITY_EVENT_TYPES.VALIDATION_ERROR,
    };
  }
  
  // Default for unclassified errors - MEDIUM
  return {
    severity: 'MEDIUM',
    category: 'External Services',
    eventType: SECURITY_EVENT_TYPES.UNHANDLED_ERROR,
  };
}

export const errorHandler = async (err: Error, c: Context) => {
  console.error('Error:', err);

  const ip = c.req.header('CF-Connecting-IP') || 
             c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 
             c.req.header('X-Real-IP') || 
             'unknown';

  // Don't log client errors (4xx) as security events unless they're auth related
  const shouldLogSecurity = !(err instanceof HTTPException && err.status < 500) || 
                           (err instanceof HTTPException && (err.status === 401 || err.status === 403));

  if (shouldLogSecurity) {
    const classification = classifyError(err);
    
    // Get request context
    const path = c.req.path;
    const method = c.req.method;
    const userAgent = c.req.header('User-Agent')?.slice(0, 200);
    const userId = (c as any).user?.wallet;
    
    await securityMonitor.log({
      severity: classification.severity,
      category: classification.category,
      eventType: classification.eventType,
      message: `Error: ${err.message}`,
      details: {
        path,
        method,
        errorName: err.constructor.name,
        stack: err.stack?.slice(0, 1000),
        userAgent,
        httpStatus: err instanceof HTTPException ? err.status : 500,
      },
      source: 'global-error-handler',
      ip,
      userId,
    });
  }

  // Handle HTTPException
  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: err.message,
      statusCode: err.status,
    }, err.status);
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      success: false,
      error: 'Validation Error',
      details: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    }, 400);
  }

  // Handle Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      return c.json({
        success: false,
        error: 'Duplicate entry',
        field: prismaError.meta?.target,
      }, 409);
    }
    if (prismaError.code === 'P2025') {
      return c.json({
        success: false,
        error: 'Record not found',
      }, 404);
    }
  }

  // Default error response
  return c.json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  }, 500);
};