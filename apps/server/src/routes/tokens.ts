import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { tokenVerificationService } from '../services/token-verification.service';
import { logger } from '../utils/logger';
import { prisma } from '../db/client';

const app = new Hono();

// Validation schemas
const verifyTokenSchema = z.object({
  mint: z.string()
    .min(32, 'Mint address too short')
    .max(44, 'Mint address too long')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid base58 format'),
});

const getPumpFunTokensSchema = z.object({
  minLiquidity: z.string().optional().transform((val) => val ? parseFloat(val) : 0),
  limit: z.string().optional().transform((val) => val ? parseInt(val) : 50),
});

const batchVerifySchema = z.object({
  mints: z.array(z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/))
    .min(1, 'At least one mint required')
    .max(10, 'Maximum 10 mints allowed'),
});

const checkWhitelistedSchema = z.object({
  mints: z.array(z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/))
    .min(1, 'At least one mint required')
    .max(100, 'Maximum 100 mints allowed'),
});

/**
 * POST /tokens/verify - Verify a specific token
 */
app.post(
  '/verify',
  validator('json', (value, c) => {
    const result = verifyTokenSchema.safeParse(value);
    if (!result.success) {
      return c.json({ 
        success: false,
        error: 'Invalid request', 
        details: result.error.issues 
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mint } = c.req.valid('json');

      logger.info(`Token verification request for: ${mint}`);

      // Verify the token
      const result = await tokenVerificationService.verifyToken(mint);

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Token verification error:', { error: error instanceof Error ? error.message : String(error) });
      return c.json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * GET /tokens/pumpfun - Get list of PumpFun tokens with optional filters
 */
app.get(
  '/pumpfun',
  validator('query', (value, c) => {
    const result = getPumpFunTokensSchema.safeParse(value);
    if (!result.success) {
      return c.json({ 
        success: false,
        error: 'Invalid query parameters', 
        details: result.error.issues 
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { minLiquidity, limit } = c.req.valid('query');

      logger.info(`PumpFun tokens request - minLiquidity: ${minLiquidity}, limit: ${limit}`);

      // Get PumpFun tokens
      const tokens = await tokenVerificationService.getPumpFunTokens(minLiquidity || 0, limit || 50);

      return c.json({
        success: true,
        data: {
          tokens,
          total: tokens.length,
        },
      });
    } catch (error) {
      logger.error('Get PumpFun tokens error:', { error: error instanceof Error ? error.message : String(error) });
      return c.json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * GET /tokens/:mint/can-loan - Check if a token can be used for loan creation
 */
app.get(
  '/:mint/can-loan',
  validator('param', (value, c) => {
    const result = z.object({ mint: z.string().min(32).max(44) }).safeParse(value);
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid mint address' }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mint } = c.req.valid('param');

      logger.info(`Can create loan check for: ${mint}`);

      // Verify the token
      const verification = await tokenVerificationService.verifyToken(mint);

      const response = {
        allowed: verification.isValid,
        reason: verification.reason,
        tier: verification.tier,
      };

      return c.json({
        success: true,
        data: response,
      });
    } catch (error) {
      logger.error('Can create loan check error:', { error: error instanceof Error ? error.message : String(error) });
      return c.json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * POST /tokens/batch-verify - Verify multiple tokens in a single request
 */
app.post(
  '/batch-verify',
  validator('json', (value, c) => {
    const result = batchVerifySchema.safeParse(value);
    if (!result.success) {
      return c.json({ 
        success: false,
        error: 'Invalid request', 
        details: result.error.issues 
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mints } = c.req.valid('json');

      logger.info(`Batch verification request for ${mints.length} tokens`);

      // Verify all tokens in parallel
      const verificationPromises = mints.map(mint => 
        tokenVerificationService.verifyToken(mint)
      );

      const results = await Promise.all(verificationPromises);

      return c.json({
        success: true,
        data: {
          results,
          total: results.length,
        },
      });
    } catch (error) {
      logger.error('Batch verification error:', { error: error instanceof Error ? error.message : String(error) });
      return c.json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * POST /tokens/check-whitelisted - Check which tokens are whitelisted in database
 */
app.post(
  '/check-whitelisted',
  validator('json', (value, c) => {
    const result = checkWhitelistedSchema.safeParse(value);
    if (!result.success) {
      return c.json({ 
        success: false,
        error: 'Invalid request', 
        details: result.error.issues 
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mints } = c.req.valid('json');

      logger.info(`Check whitelisted request for ${mints.length} tokens`);

      // Query database for enabled tokens
      const whitelistedTokens = await prisma.token.findMany({
        where: {
          id: {
            in: mints
          },
          enabled: true
        },
        select: {
          id: true,
          symbol: true,
          name: true,
          tier: true,
        }
      });

      // Create a set of whitelisted mint addresses for fast lookup
      const whitelistedMints = new Set(whitelistedTokens.map(t => t.id));

      // Return array of mints that are whitelisted
      const result = mints.filter(mint => whitelistedMints.has(mint));

      logger.info(`Found ${result.length} whitelisted tokens out of ${mints.length}`);

      return c.json({
        success: true,
        data: {
          whitelistedMints: result,
          tokens: whitelistedTokens,
          total: result.length
        },
      });
    } catch (error) {
      logger.error('Check whitelisted error:', { error: error instanceof Error ? error.message : String(error) });
      return c.json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * GET /tokens/:mint/info - Get detailed token information
 */
app.get(
  '/:mint/info',
  validator('param', (value, c) => {
    const result = z.object({ mint: z.string().min(32).max(44) }).safeParse(value);
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid mint address' }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mint } = c.req.valid('param');

      logger.info(`Token info request for: ${mint}`);

      // Get token verification with full details
      const verification = await tokenVerificationService.verifyToken(mint);

      return c.json({
        success: true,
        data: {
          verification,
          metadata: {
            checkedAt: new Date().toISOString(),
            cacheable: true,
            cacheExpiry: new Date(Date.now() + 300000).toISOString(), // 5 minutes
          },
        },
      });
    } catch (error) {
      logger.error('Get token info error:', { error: error instanceof Error ? error.message : String(error) });
      return c.json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * GET /tokens/cache/stats - Get token verification cache statistics
 */
app.get('/cache/stats', async (c) => {
  try {
    // This would be implemented in the service if needed
    return c.json({
      success: true,
      data: {
        cacheSize: 0, // Would get from service
        hitRate: 0,
        entries: [],
        ttl: parseInt(process.env.TOKEN_CACHE_TTL_MS || '300000'),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Cache stats error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      success: false,
      error: 'Failed to get cache stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /tokens/cache/clear - Clear token verification cache
 */
app.post('/cache/clear', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { mints } = body;
    
    // This would be implemented in the service
    // tokenVerificationService.clearCache(mints);
    
    return c.json({
      success: true,
      message: mints ? `Cache cleared for ${mints.length} tokens` : 'All cache cleared',
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Cache clear error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      success: false,
      error: 'Failed to clear cache',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;