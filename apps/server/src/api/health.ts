import { Hono } from 'hono';
import { getConnection } from '../services/solana.service.js';
import { prisma } from '../db/client.js';
import { treasuryHealthService } from '../services/treasury-health.service.js';
import { isCircuitBreakerTripped } from '../services/circuit-breaker.service.js';
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