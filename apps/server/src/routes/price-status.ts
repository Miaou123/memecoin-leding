import { Request, Response, Router } from 'express';
import { priceService } from '../services/price.service.js';
import { fastPriceMonitor } from '../services/fast-price-monitor.js';

const router = Router();

/**
 * Get price service status including sources and monitoring
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    // Get price service status
    const priceServiceStatus = priceService.getServiceStatus();
    
    // Get fast price monitor status
    const monitorStatus = fastPriceMonitor.getStatus();
    
    // Test Jupiter connection
    const jupiterTest = await priceService.testJupiterConnection();
    
    res.json({
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
        pumpfun: {
          available: priceServiceStatus.pumpFunAvailable,
        },
        dexscreener: {
          available: priceServiceStatus.dexScreenerAvailable,
        },
      },
    });
  } catch (error) {
    console.error('Failed to get price status:', error);
    res.status(500).json({
      error: 'Failed to get price status',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Force refresh prices for specific tokens
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { mints } = req.body;
    
    if (!Array.isArray(mints) || mints.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'mints must be a non-empty array',
      });
    }
    
    // Clear cache for specified mints
    priceService.clearCache(mints);
    
    // Fetch fresh prices
    const prices = await priceService.getPrices(mints);
    
    res.json({
      success: true,
      refreshed: mints.length,
      prices: Object.fromEntries(prices),
    });
  } catch (error) {
    console.error('Failed to refresh prices:', error);
    res.status(500).json({
      error: 'Failed to refresh prices',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get current cache statistics
 */
router.get('/cache-stats', async (req: Request, res: Response) => {
  try {
    const stats = priceService.getCacheStats();
    res.json(stats);
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    res.status(500).json({
      error: 'Failed to get cache stats',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;