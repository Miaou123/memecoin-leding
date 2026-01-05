import { Hono } from 'hono';
import { requireAdminApiKey } from '../middleware/adminApiKey.js';
import {
  getRecentLiquidations,
  getTokenLiquidationStats,
  getLiquidationsWithLosses,
} from '../services/liquidation-tracker.service.js';
import {
  getAllExposures,
  getTokenExposure,
  getTokensWithWarnings,
  refreshAllExposures,
} from '../services/exposure-monitor.service.js';
import {
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  isCircuitBreakerTripped,
} from '../services/circuit-breaker.service.js';
import type { ApiResponse } from '@memecoin-lending/types';

export const monitoringRouter = new Hono();

// Get recent liquidations
monitoringRouter.get('/liquidations', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const liquidations = getRecentLiquidations(limit);

  return c.json<ApiResponse<any>>({
    success: true,
    data: liquidations.map(l => ({
      ...l,
      expectedSolRecovery: l.expectedSolRecovery.toString(),
      actualSolRecovery: l.actualSolRecovery.toString(),
      expectedSol: Number(l.expectedSolRecovery) / 1e9,
      actualSol: Number(l.actualSolRecovery) / 1e9,
      lossPct: l.lossBps / 100,
    })),
  });
});

// Get liquidations with losses only
monitoringRouter.get('/liquidations/losses', async (c) => {
  const liquidations = getLiquidationsWithLosses();

  return c.json<ApiResponse<any>>({
    success: true,
    data: liquidations.map(l => ({
      ...l,
      expectedSolRecovery: l.expectedSolRecovery.toString(),
      actualSolRecovery: l.actualSolRecovery.toString(),
      expectedSol: Number(l.expectedSolRecovery) / 1e9,
      actualSol: Number(l.actualSolRecovery) / 1e9,
      lossPct: l.lossBps / 100,
    })),
  });
});

// Get liquidation stats for a specific token
monitoringRouter.get('/liquidations/token/:mint', async (c) => {
  const mint = c.req.param('mint');
  const stats = getTokenLiquidationStats(mint);

  return c.json<ApiResponse<any>>({
    success: true,
    data: {
      ...stats,
      totalLossLamports: stats.totalLossLamports.toString(),
      totalLossSol: Number(stats.totalLossLamports) / 1e9,
      avgLossPct: stats.avgLossBps / 100,
    },
  });
});

// Get all token exposures
monitoringRouter.get('/exposures', async (c) => {
  const exposures = getAllExposures();

  return c.json<ApiResponse<any>>({
    success: true,
    data: exposures.map(e => ({
      ...e,
      totalCollateralAmount: e.totalCollateralAmount.toString(),
      totalSolLent: e.totalSolLent.toString(),
      poolLiquidity: e.poolLiquidity.toString(),
      totalSolLentNum: Number(e.totalSolLent) / 1e9,
      poolLiquidityNum: Number(e.poolLiquidity) / 1e9,
      exposurePct: e.exposureBps / 100,
    })),
  });
});

// Get tokens with exposure warnings
monitoringRouter.get('/exposures/warnings', async (c) => {
  const exposures = getTokensWithWarnings();

  return c.json<ApiResponse<any>>({
    success: true,
    data: exposures.map(e => ({
      ...e,
      totalCollateralAmount: e.totalCollateralAmount.toString(),
      totalSolLent: e.totalSolLent.toString(),
      poolLiquidity: e.poolLiquidity.toString(),
      totalSolLentNum: Number(e.totalSolLent) / 1e9,
      poolLiquidityNum: Number(e.poolLiquidity) / 1e9,
      exposurePct: e.exposureBps / 100,
    })),
  });
});

// Get exposure for specific token
monitoringRouter.get('/exposures/token/:mint', async (c) => {
  const mint = c.req.param('mint');
  const exposure = getTokenExposure(mint);

  if (!exposure) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: 'Token not found in exposure tracking',
    }, 404);
  }

  return c.json<ApiResponse<any>>({
    success: true,
    data: {
      ...exposure,
      totalCollateralAmount: exposure.totalCollateralAmount.toString(),
      totalSolLent: exposure.totalSolLent.toString(),
      poolLiquidity: exposure.poolLiquidity.toString(),
      totalSolLentNum: Number(exposure.totalSolLent) / 1e9,
      poolLiquidityNum: Number(exposure.poolLiquidity) / 1e9,
      exposurePct: exposure.exposureBps / 100,
    },
  });
});

// Admin: Force refresh all exposures
monitoringRouter.post('/exposures/refresh', requireAdminApiKey, async (c) => {
  await refreshAllExposures();

  return c.json<ApiResponse<{ message: string }>>({
    success: true,
    data: { message: 'Exposure data refreshed' },
  });
});

// Get circuit breaker status
monitoringRouter.get('/circuit-breaker', async (c) => {
  const status = await getCircuitBreakerStatus();
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: {
      ...status,
      metrics: {
        loss24hSol: Number(status.metrics.loss24h) / 1e9,
        loss1hSol: Number(status.metrics.loss1h) / 1e9,
        liquidationCount1h: status.metrics.liquidationCount1h,
      },
    },
  });
});

// Admin: Reset circuit breaker
monitoringRouter.post('/circuit-breaker/reset', requireAdminApiKey, async (c) => {
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  
  await resetCircuitBreaker(adminKey);
  
  return c.json<ApiResponse<{ message: string }>>({
    success: true,
    data: { message: 'Circuit breaker reset successfully' },
  });
});