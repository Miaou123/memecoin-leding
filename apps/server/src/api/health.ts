import { Hono } from 'hono';
import { getConnection } from '../services/solana.service.js';
import { prisma } from '../db/client.js';
import { treasuryHealthService } from '../services/treasury-health.service.js';
import { isCircuitBreakerTripped } from '../services/circuit-breaker.service.js';
import { getLiquidatorHealth } from '../jobs/index.js';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export const healthRouter = new Hono();

// Basic liveness check
healthRouter.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness check (all dependencies)
healthRouter.get('/ready', async (c) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
  
  // Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (error: any) {
    checks.database = { ok: false, error: error.message };
  }
  
  // Redis check
  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (error: any) {
    checks.redis = { ok: false, error: error.message };
  }
  
  // Solana RPC check
  const solanaStart = Date.now();
  try {
    const connection = getConnection();
    await connection.getSlot();
    checks.solana = { ok: true, latencyMs: Date.now() - solanaStart };
  } catch (error: any) {
    checks.solana = { ok: false, error: error.message };
  }
  
  const allOk = Object.values(checks).every(c => c.ok);
  
  return c.json({
    status: allOk ? 'ready' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }, allOk ? 200 : 503);
});

// Detailed metrics endpoint
healthRouter.get('/metrics', async (c) => {
  const [
    activeLoans,
    totalLoans,
    totalTokens,
  ] = await Promise.all([
    prisma.loan.count({ where: { status: 'Active' } }),
    prisma.loan.count(),
    prisma.token.count(),
  ]);
  
  const treasury = treasuryHealthService.getStatus();
  const circuitBreakerTripped = isCircuitBreakerTripped();
  
  return c.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    protocol: {
      activeLoans,
      totalLoans,
      totalTokens,
      treasuryBalanceSol: treasury.balanceSol,
      treasuryHealth: treasury.healthStatus,
      circuitBreakerTripped,
    },
  });
});

// Liquidator health endpoint
healthRouter.get('/health/liquidator', async (c) => {
  try {
    const health = await getLiquidatorHealth();
    const isHealthy = health.status === 'healthy';
    
    // Calculate minutes since last successful run
    let minutesSinceLastSuccess = null;
    if (health.currentInstance.lastSuccessfulRun) {
      const msSinceLastRun = Date.now() - health.currentInstance.lastSuccessfulRun.getTime();
      minutesSinceLastSuccess = Math.floor(msSinceLastRun / 60000);
    }
    
    const response = {
      status: health.status,
      instanceId: health.currentInstance.instanceId,
      lastSuccessfulRun: health.currentInstance.lastSuccessfulRun,
      minutesSinceLastSuccess,
      consecutiveFailures: health.currentInstance.consecutiveFailures,
      totalLiquidations24h: health.globalMetrics.totalLiquidations24h,
      allInstances: health.allInstances.map(instance => ({
        instanceId: instance.instanceId,
        isHealthy: instance.isHealthy,
        lastSuccessfulRun: instance.lastSuccessfulRun,
        consecutiveFailures: instance.consecutiveFailures,
        avgProcessingTimeMs: instance.avgProcessingTimeMs,
      })),
      summary: health.summary,
    };
    
    return c.json(response, isHealthy ? 200 : 503);
  } catch (error: any) {
    console.error('Failed to get liquidator health:', error);
    return c.json({
      status: 'error',
      error: error.message,
    }, 500);
  }
});