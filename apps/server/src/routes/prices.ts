import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { priceService } from '../services/price';
import { logger } from '../utils/logger';
import { getAllTokenDefinitions } from '@memecoin-lending/config';

const app = new Hono();

// Validation schemas
const getPricesSchema = z.object({
  mints: z.string().optional(),
  tokens: z.string().optional(),
});

const getSinglePriceSchema = z.object({
  mint: z.string().min(32).max(44), // Solana address length
});

/**
 * GET /prices - Get prices for multiple tokens
 * Query params:
 * - mints: comma-separated list of token mint addresses
 * - tokens: if 'all', returns prices for all whitelisted tokens
 */
app.get(
  '/',
  validator('query', (value, c) => {
    const result = getPricesSchema.safeParse(value);
    if (!result.success) {
      return c.json({ error: 'Invalid query parameters', details: result.error.issues }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mints, tokens } = c.req.valid('query');
      
      let mintsList: string[] = [];
      
      if (tokens === 'all') {
        // Get all whitelisted token mints
        const tokenDefinitions = getAllTokenDefinitions();
        mintsList = tokenDefinitions.map(token => token.mint);
      } else if (mints) {
        // Parse comma-separated mints
        mintsList = mints.split(',').map(mint => mint.trim()).filter(mint => mint.length > 0);
      } else {
        return c.json({ error: 'Either mints or tokens=all parameter required' }, 400);
      }

      if (mintsList.length === 0) {
        return c.json({ error: 'No valid mints provided' }, 400);
      }

      if (mintsList.length > 50) {
        return c.json({ error: 'Too many mints requested (max 50)' }, 400);
      }

      logger.info(`Price request for ${mintsList.length} tokens`);
      
      const prices = await priceService.getPrices(mintsList);
      
      // Convert Map to object
      const result: Record<string, any> = {};
      for (const [mint, price] of prices.entries()) {
        result[mint] = {
          mint: price.mint,
          usdPrice: price.usdPrice,
          solPrice: price.solPrice,
          decimals: price.decimals,
          priceChange24h: price.priceChange24h,
          source: price.source,
          timestamp: price.timestamp,
        };
      }

      // Add missing tokens as null
      for (const mint of mintsList) {
        if (!result[mint]) {
          result[mint] = null;
        }
      }

      return c.json({
        success: true,
        data: result,
        timestamp: Date.now(),
        cached: mintsList.length - prices.size,
      });

    } catch (error) {
      logger.error('Price fetch error:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch prices',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }
);

/**
 * GET /prices/:mint - Get price for a single token
 */
app.get(
  '/:mint',
  validator('param', (value, c) => {
    const result = getSinglePriceSchema.safeParse(value);
    if (!result.success) {
      return c.json({ error: 'Invalid mint address' }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mint } = c.req.valid('param');
      
      logger.info(`Single price request for: ${mint}`);
      
      const price = await priceService.getPrice(mint);
      
      if (!price) {
        return c.json({
          success: false,
          error: 'Price not found',
          data: null,
        }, 404);
      }

      return c.json({
        success: true,
        data: {
          mint: price.mint,
          usdPrice: price.usdPrice,
          solPrice: price.solPrice,
          decimals: price.decimals,
          priceChange24h: price.priceChange24h,
          source: price.source,
          timestamp: price.timestamp,
        },
        timestamp: Date.now(),
      });

    } catch (error) {
      logger.error('Single price fetch error:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch price',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }
);

/**
 * GET /prices/sol/usd - Get SOL price in USD
 */
app.get('/sol/usd', async (c) => {
  try {
    const solPrice = await priceService.getSolPrice();
    
    if (!solPrice) {
      return c.json({
        success: false,
        error: 'SOL price not available',
        data: null,
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        usdPrice: solPrice,
        timestamp: Date.now(),
      },
    });

  } catch (error) {
    logger.error('SOL price fetch error:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch SOL price',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /prices/cache/clear - Clear price cache (admin only)
 */
app.post('/cache/clear', async (c) => {
  try {
    // In a real implementation, you'd want admin authentication here
    const body = await c.req.json().catch(() => ({}));
    const { mints } = body;
    
    priceService.clearCache(mints);
    
    return c.json({
      success: true,
      message: mints ? `Cache cleared for ${mints.length} tokens` : 'All cache cleared',
      timestamp: Date.now(),
    });

  } catch (error) {
    logger.error('Cache clear error:', error);
    return c.json({
      success: false,
      error: 'Failed to clear cache',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /prices/cache/stats - Get cache statistics
 */
app.get('/cache/stats', async (c) => {
  try {
    const stats = priceService.getCacheStats();
    
    return c.json({
      success: true,
      data: stats,
      timestamp: Date.now(),
    });

  } catch (error) {
    logger.error('Cache stats error:', error);
    return c.json({
      success: false,
      error: 'Failed to get cache stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /prices/status - Get price service status
 */
app.get('/status', async (c) => {
  try {
    const status = priceService.getServiceStatus();
    
    return c.json({
      success: true,
      data: {
        ...status,
        services: {
          jupiter: {
            apiKey: undefined,
            endpoint: 'https://api.jup.ag',
          },
          dexscreener: {
            endpoint: 'https://api.dexscreener.com/latest/dex',
          }
        },
      },
      timestamp: Date.now(),
    });

  } catch (error) {
    logger.error('Price service status error:', error);
    return c.json({
      success: false,
      error: 'Failed to get service status',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /prices/test - Test Jupiter API connection
 */
app.get('/test', async (c) => {
  try {
    const testResult = await priceService.testJupiterConnection();
    
    return c.json({
      success: testResult.working,
      data: {
        jupiter: testResult,
        recommendations: testResult.working 
          ? ['✅ Jupiter API connection successful']
          : [
              '❌ Jupiter API connection failed',
              `Error: ${testResult.error}`,
              ...(testResult.error?.includes('401') || testResult.error?.includes('403') 
                ? ['🔑 Check your API key configuration']
                : []
              )
            ]
      },
      timestamp: Date.now(),
    }, testResult.working ? 200 : 502);

  } catch (error) {
    logger.error('Jupiter API test error:', error);
    return c.json({
      success: false,
      error: 'Failed to test Jupiter API',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;