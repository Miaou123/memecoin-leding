import { Hono } from 'hono';
import { ApiResponse, ProtocolStats } from '@memecoin-lending/types';
import { protocolService } from '../services/protocol.service.js';
import { requireAdmin } from '../middleware/auth.js';
import { apiRateLimit } from '../middleware/rateLimit.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const protocolRouter = new Hono();

// Apply rate limiting
protocolRouter.use('/*', apiRateLimit);

// Get protocol statistics
protocolRouter.get('/stats', async (c) => {
  const stats = await protocolService.getProtocolStats();
  
  return c.json<ApiResponse<ProtocolStats>>({
    success: true,
    data: stats,
  });
});

// Get treasury balance
protocolRouter.get('/treasury', async (c) => {
  const balance = await protocolService.getTreasuryBalance();
  
  return c.json<ApiResponse<{ balance: string }>>({
    success: true,
    data: { balance },
  });
});

// Get protocol configuration
protocolRouter.get('/config', async (c) => {
  const config = await protocolService.getProtocolConfig();
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: config,
  });
});

// Admin: Pause protocol
protocolRouter.post('/pause', requireAdmin, async (c) => {
  try {
    await protocolService.pauseProtocol();
    
    return c.json<ApiResponse<{ message: string }>>({
      success: true,
      data: { message: 'Protocol paused successfully' },
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Admin: Resume protocol
protocolRouter.post('/resume', requireAdmin, async (c) => {
  try {
    await protocolService.resumeProtocol();
    
    return c.json<ApiResponse<{ message: string }>>({
      success: true,
      data: { message: 'Protocol resumed successfully' },
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Admin: Whitelist token
const whitelistTokenSchema = z.object({
  mint: z.string(),
  tier: z.enum(['bronze', 'silver', 'gold']),
  poolAddress: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
});

protocolRouter.post(
  '/whitelist-token',
  requireAdmin,
  zValidator('json', whitelistTokenSchema),
  async (c) => {
    const body = c.req.valid('json');
    
    try {
      await protocolService.whitelistToken(body);
      
      return c.json<ApiResponse<{ message: string }>>({
        success: true,
        data: { message: 'Token whitelisted successfully' },
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Admin: Update token config
const updateTokenConfigSchema = z.object({
  mint: z.string(),
  enabled: z.boolean().optional(),
  ltvBps: z.number().optional(),
  interestRateBps: z.number().optional(),
});

protocolRouter.put(
  '/token-config',
  requireAdmin,
  zValidator('json', updateTokenConfigSchema),
  async (c) => {
    const body = c.req.valid('json');
    
    try {
      await protocolService.updateTokenConfig(body);
      
      return c.json<ApiResponse<{ message: string }>>({
        success: true,
        data: { message: 'Token config updated successfully' },
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Admin: Withdraw treasury
const withdrawSchema = z.object({
  amount: z.string(),
});

protocolRouter.post(
  '/withdraw-treasury',
  requireAdmin,
  zValidator('json', withdrawSchema),
  async (c) => {
    const { amount } = c.req.valid('json');
    
    try {
      const txSignature = await protocolService.withdrawTreasury(amount);
      
      return c.json<ApiResponse<{ txSignature: string }>>({
        success: true,
        data: { txSignature },
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

export { protocolRouter };