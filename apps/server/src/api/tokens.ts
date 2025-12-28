import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ApiResponse, TokenStats, PriceData } from '@memecoin-lending/types';
import { tokenService } from '../services/token.service.js';
import { priceService } from '../services/price.service.js';
import { prisma } from '../db/client.js';
import { apiRateLimit } from '../middleware/rateLimit.js';

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
    tokens.map(token => tokenService.getTokenStats(token.id))
  );
  
  return c.json<ApiResponse<TokenStats[]>>({
    success: true,
    data: tokenStats,
  });
});

// Get single token details
tokensRouter.get('/:mint', async (c) => {
  const mint = c.req.param('mint');
  
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
});

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

export { tokensRouter };