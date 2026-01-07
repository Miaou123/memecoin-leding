import { Hono } from 'hono';
import { priceService } from '../services/price.service.js';
import { fastPriceMonitor } from '../services/fast-price-monitor.js';
import { jupiterClient } from '../services/jupiter-client.js';

const priceStatusRouter = new Hono();

/**
 * Get price service status including sources and monitoring
 */
priceStatusRouter.get('/status', async (c) => {
  try {
    // Get price service status
    const priceServiceStatus = priceService.getServiceStatus();
    
    // Get fast price monitor status
    const monitorStatus = fastPriceMonitor.getStatus();
    
    // Test Jupiter connection
    const jupiterTest = await priceService.testJupiterConnection();
    
    return c.json({
      priceService: {
        ...priceServiceStatus,
        jupiterConnection: jupiterTest,
      },
      fastPriceMonitor: monitorStatus,
      sources: {
        jupiter: {
          available: priceServiceStatus.jupiterAvailable,
          lastCheck: jupiterTest.working ? Date.now() : null,
          latency: jupiterTest.latency,
          error: jupiterTest.error,
        },
        dexscreener: {
          available: priceServiceStatus.dexScreenerAvailable,
        },
      },
    });
  } catch (error) {
    console.error('Failed to get price status:', error);
    return c.json({
      error: 'Failed to get price status',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Force refresh prices for specific tokens
 */
priceStatusRouter.post('/refresh', async (c) => {
  try {
    const { mints } = await c.req.json();
    
    if (!Array.isArray(mints) || mints.length === 0) {
      return c.json({
        error: 'Invalid request',
        details: 'mints must be a non-empty array',
      }, 400);
    }
    
    // Clear cache for specified mints
    priceService.clearCache(mints);
    
    // Fetch fresh prices
    const prices = await priceService.getPrices(mints);
    
    return c.json({
      success: true,
      refreshed: mints.length,
      prices: Object.fromEntries(prices),
    });
  } catch (error) {
    console.error('Failed to refresh prices:', error);
    return c.json({
      error: 'Failed to refresh prices',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get current cache statistics
 */
priceStatusRouter.get('/cache-stats', async (c) => {
  try {
    const stats = priceService.getCacheStats();
    return c.json(stats);
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    return c.json({
      error: 'Failed to get cache stats',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get Jupiter API endpoints health
 */
priceStatusRouter.get('/jupiter-health', async (c) => {
  try {
    return c.json({
      success: true,
      data: jupiterClient.getHealthStatus(),
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to get Jupiter health:', error);
    return c.json({
      error: 'Failed to get Jupiter health',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Reset all Jupiter endpoints to healthy
 */
priceStatusRouter.post('/jupiter-reset', async (c) => {
  try {
    jupiterClient.resetAllEndpoints();
    return c.json({
      success: true,
      message: 'All Jupiter endpoints reset to healthy',
      data: jupiterClient.getHealthStatus(),
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to reset Jupiter endpoints:', error);
    return c.json({
      error: 'Failed to reset Jupiter endpoints',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Test specific Jupiter endpoint
 */
priceStatusRouter.get('/jupiter-test/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id') || '0');
    const result = await jupiterClient.testEndpoint(id);
    
    return c.json({
      success: result.success,
      data: result,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to test Jupiter endpoint:', error);
    return c.json({
      error: 'Failed to test Jupiter endpoint',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default priceStatusRouter;