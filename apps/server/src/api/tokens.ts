import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ApiResponse, TokenStats, PriceData } from '@memecoin-lending/types';
import { tokenService } from '../services/token.service.js';
import { priceService } from '../services/price.service.js';
import { tokenVerificationService } from '../services/token-verification.service.js';
import { fetchTokenMetadata } from '../services/token-metadata.service.js';
import { Connection } from '@solana/web3.js';
import { getNetworkConfig, NetworkType } from '@memecoin-lending/config';
import { prisma } from '../db/client.js';
import { apiRateLimit } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import { verifyTokenSchema, batchVerifyTokensSchema, solanaAddressSchema } from '../validators/index.js';
import { sanitizeForLogging } from '../utils/inputSanitizer.js';

const tokensRouter = new Hono();

// Apply rate limiting
tokensRouter.use('/*', apiRateLimit);

// Get all whitelisted tokens
tokensRouter.get('/', async (c) => {
  const tokens = await prisma.token.findMany({
    where: { enabled: true },
    orderBy: { tier: 'asc' },
  });
  
  const tokenStats = await Promise.all(
    tokens.map((token: any) => tokenService.getTokenStats(token.id))
  );
  
  return c.json<ApiResponse<TokenStats[]>>({
    success: true,
    data: tokenStats,
  });
});

// Get top collateral token for dashboard (must come before /:mint to avoid conflict)
tokensRouter.get('/top-collateral', async (c) => {
  try {
    // Get the token with the highest total collateral value
    // First, let's get active loans and calculate manually
    const activeLoans = await prisma.loan.findMany({
      where: {
        status: 'active'
      },
      select: {
        tokenMint: true,
        collateralAmount: true,
      },
    });

    if (!activeLoans.length) {
      return c.json<ApiResponse<null>>({
        success: true,
        data: null,
      });
    }

    // Group by tokenMint and sum collateral manually
    const tokenStats = new Map<string, { total: bigint; count: number }>();
    
    for (const loan of activeLoans) {
      const mint = loan.tokenMint;
      const amount = BigInt(loan.collateralAmount);
      const existing = tokenStats.get(mint) || { total: 0n, count: 0 };
      tokenStats.set(mint, {
        total: existing.total + amount,
        count: existing.count + 1,
      });
    }

    // Find the token with highest collateral
    let topMint = '';
    let maxCollateral = 0n;
    let maxCount = 0;

    for (const [mint, stats] of tokenStats) {
      if (stats.total > maxCollateral) {
        maxCollateral = stats.total;
        topMint = mint;
        maxCount = stats.count;
      }
    }

    if (!topMint) {
      return c.json<ApiResponse<null>>({
        success: true,
        data: null,
      });
    }

    // Get token info
    const token = await prisma.token.findUnique({
      where: { id: topMint },
    });

    const result = {
      mint: topMint,
      symbol: token?.symbol || 'UNKNOWN',
      name: token?.name || 'Unknown Token',
      totalCollateralAmount: maxCollateral.toString(),
      activeLoansCount: maxCount,
    };

    return c.json<ApiResponse<typeof result>>({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 500);
  }
});

// Get single token details
tokensRouter.get(
  '/:mint',
  zValidator('param', z.object({ mint: solanaAddressSchema })),
  async (c) => {
    const { mint } = c.req.valid('param');
    
    const token = await prisma.token.findUnique({
      where: { id: mint },
    });
    
    if (!token) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: 'Token not found',
      }, 404);
    }
    
    const stats = await tokenService.getTokenStats(mint);
    
    return c.json<ApiResponse<TokenStats>>({
      success: true,
      data: stats,
    });
  }
);

// Get token price
tokensRouter.get('/:mint/price', async (c) => {
  const mint = c.req.param('mint');
  
  try {
    const price = await priceService.getCurrentPrice(mint);
    
    return c.json<ApiResponse<PriceData>>({
      success: true,
      data: price,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Get token price history
const priceHistorySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  interval: z.enum(['1h', '4h', '1d']).default('1h'),
});

tokensRouter.get(
  '/:mint/price-history',
  zValidator('query', priceHistorySchema),
  async (c) => {
    const mint = c.req.param('mint');
    const query = c.req.valid('query');
    
    const to = query.to || new Date();
    const from = query.from || new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    const priceHistory = await prisma.priceHistory.findMany({
      where: {
        tokenMint: mint,
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { timestamp: 'asc' },
    });
    
    // Group by interval
    const grouped = priceService.groupPriceHistory(priceHistory, query.interval);
    
    return c.json<ApiResponse<PriceData[]>>({
      success: true,
      data: grouped,
    });
  }
);

// Get token liquidity info
tokensRouter.get('/:mint/liquidity', async (c) => {
  const mint = c.req.param('mint');
  
  try {
    const liquidity = await tokenService.getTokenLiquidity(mint);
    
    return c.json<ApiResponse<any>>({
      success: true,
      data: liquidity,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Token verification endpoints

// POST /tokens/verify - Verify a specific token
tokensRouter.post(
  '/verify',
  zValidator('json', verifyTokenSchema),
  async (c) => {
    try {
      const { mint } = c.req.valid('json');

      logger.info('Token verification request', { 
        mint: sanitizeForLogging(mint.substring(0, 8) + '...'),
      });

      // Verify the token
      const result = await tokenVerificationService.verifyToken(mint);

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Token verification error:', { 
        error: sanitizeForLogging(error),
      });
      return c.json({
        success: false,
        error: 'Internal server error',
      }, 500);
    }
  }
);

// GET /tokens/pumpfun - Get list of PumpFun tokens
const getPumpFunTokensSchema = z.object({
  minLiquidity: z.string().optional().transform((val) => val ? parseFloat(val) : 0),
  limit: z.string().optional().transform((val) => val ? parseInt(val) : 50),
});

tokensRouter.get(
  '/pumpfun',
  zValidator('query', getPumpFunTokensSchema),
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

// POST /tokens/batch-verify - Verify multiple tokens
tokensRouter.post(
  '/batch-verify',
  zValidator('json', batchVerifyTokensSchema),
  async (c) => {
    try {
      const { mints } = c.req.valid('json');

      // mints are already sanitized by the schema
      const results = await Promise.all(
        mints.map(mint => tokenVerificationService.verifyToken(mint))
      );

      return c.json({
        success: true,
        data: { results },
      });
    } catch (error) {
      logger.error('Batch verification error:', { 
        error: sanitizeForLogging(error),
      });
      return c.json({
        success: false,
        error: 'Internal server error',
      }, 500);
    }
  }
);

// GET /tokens/:mint/can-loan - Check if token can be used for loans
tokensRouter.get('/:mint/can-loan', async (c) => {
  try {
    const mint = c.req.param('mint');

    // Basic mint validation
    if (!mint || mint.length < 32 || mint.length > 44) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

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
});

// GET /tokens/:mint/verify - Get verification info for a token
tokensRouter.get('/:mint/verify', async (c) => {
  try {
    const mint = c.req.param('mint');

    // Basic mint validation
    if (!mint || mint.length < 32 || mint.length > 44) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    logger.info(`Token verification info request for: ${mint}`);

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
    logger.error('Get token verification info error:', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// POST /tokens/:mint/refresh-metadata - Refresh metadata for a specific token
tokensRouter.post('/:mint/refresh-metadata', async (c) => {
  try {
    const mint = c.req.param('mint');

    // Basic mint validation
    if (!mint || mint.length < 32 || mint.length > 44) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    logger.info(`Refreshing metadata for token: ${mint.slice(0, 8)}...`);

    const network = (process.env.SOLANA_NETWORK as NetworkType) || 'devnet';
    const networkConfig = getNetworkConfig(network);
    const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

    // Fetch metadata from on-chain
    const metadata = await fetchTokenMetadata(mint, connection);

    if (!metadata) {
      return c.json({
        success: false,
        error: 'No on-chain metadata found for this token',
      }, 404);
    }

    // Update database with new metadata
    const updatedToken = await prisma.token.update({
      where: { id: mint },
      data: {
        symbol: metadata.symbol,
        name: metadata.name,
        imageUrl: metadata.image,
      },
    });

    return c.json({
      success: true,
      data: {
        mint,
        metadata,
        updated: {
          symbol: updatedToken.symbol,
          name: updatedToken.name,
          imageUrl: updatedToken.imageUrl,
        },
      },
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return c.json({
        success: false,
        error: 'Token not found in database',
      }, 404);
    }

    logger.error('Refresh metadata error:', { error: error.message });
    return c.json({
      success: false,
      error: 'Internal server error',
    }, 500);
  }
});

export { tokensRouter };