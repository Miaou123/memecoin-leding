import { PrismaClient } from '@prisma/client';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

// Configuration
const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS || '30000'); // 30 seconds
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.DB_SLOW_QUERY_THRESHOLD_MS || '5000'); // 5 seconds

const prismaClientSingleton = () => {
  // Build connection URL with timeout parameters
  const baseUrl = process.env.DATABASE_URL || '';
  
  // Add PostgreSQL timeout parameters
  const separator = baseUrl.includes('?') ? '&' : '?';
  const urlWithTimeout = `${baseUrl}${separator}connect_timeout=10&statement_timeout=${QUERY_TIMEOUT_MS}`;
  
  console.log(`📊 Database configured with ${QUERY_TIMEOUT_MS}ms query timeout`);
  
  const client = new PrismaClient({
    datasources: {
      db: {
        url: urlWithTimeout,
      },
    },
    log: [
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
      ...(process.env.NODE_ENV === 'development' 
        ? [{ level: 'query' as const, emit: 'event' as const }] 
        : []),
    ],
  });
  
  // Log database errors
  client.$on('error', async (e) => {
    console.error('Database error:', e.message);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Database',
      eventType: SECURITY_EVENT_TYPES.DATABASE_ERROR || 'DATABASE_ERROR',
      message: `Database error: ${e.message.substring(0, 200)}`,
      details: {
        target: e.target,
      },
      source: 'prisma-client',
    });
  });
  
  // Log slow queries in development
  if (process.env.NODE_ENV === 'development') {
    client.$on('query', (e) => {
      if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
        console.warn(`⚠️ Slow query (${e.duration}ms):`, e.query.substring(0, 100));
      }
    });
  }
  
  // Extend with query timing
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          const start = Date.now();
          
          try {
            const result = await query(args);
            const duration = Date.now() - start;
            
            // Log slow queries
            if (duration > SLOW_QUERY_THRESHOLD_MS) {
              console.warn(`⚠️ Slow query: ${model}.${operation} took ${duration}ms`);
              
              await securityMonitor.log({
                severity: 'MEDIUM',
                category: 'Database',
                eventType: 'DB_SLOW_QUERY',
                message: `Slow query: ${model}.${operation} took ${duration}ms`,
                details: {
                  model,
                  operation,
                  duration,
                  threshold: SLOW_QUERY_THRESHOLD_MS,
                },
                source: 'prisma-extension',
              });
            }
            
            return result;
          } catch (error: any) {
            const duration = Date.now() - start;
            
            // Check if it's a timeout error
            const isTimeout = 
              error.message?.includes('timeout') ||
              error.message?.includes('canceling statement') ||
              error.code === '57014'; // PostgreSQL query_canceled
            
            if (isTimeout) {
              console.error(`⏱️ Query timeout: ${model}.${operation} after ${duration}ms`);
              
              await securityMonitor.log({
                severity: 'HIGH',
                category: 'Database',
                eventType: 'DB_QUERY_TIMEOUT',
                message: `Query timeout: ${model}.${operation} after ${duration}ms`,
                details: {
                  model,
                  operation,
                  duration,
                  timeoutMs: QUERY_TIMEOUT_MS,
                },
                source: 'prisma-extension',
              });
            }
            
            throw error;
          }
        },
      },
    },
  });
};

// Singleton pattern
declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export { prisma };