import { Hono } from 'hono';
import { ApiResponse, ProtocolStats, SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { protocolService } from '../services/protocol.service.js';
import { requireAdmin } from '../middleware/auth.js';
import { apiRateLimit } from '../middleware/rateLimit.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const protocolRouter = new Hono();

// Apply rate limiting
protocolRouter.use('/*', apiRateLimit);

// Get protocol statistics
protocolRouter.get('/stats', async (c) => {
  try {
    const stats = await protocolService.getProtocolStats();
    
    return c.json<ApiResponse<ProtocolStats>>({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('Protocol stats error:', error);
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message || 'Failed to fetch protocol statistics',
    }, 500);
  }
});

// Get protocol status (for frontend banner)
protocolRouter.get('/status', async (c) => {
  try {
    const config = await protocolService.getProtocolConfig();
    const stats = await protocolService.getProtocolStats();
    
    return c.json<ApiResponse<{ 
      paused: boolean; 
      pauseReason?: string; 
      version: string; 
      treasury: string; 
    }>>({
      success: true,
      data: {
        paused: config?.paused ?? false,
        pauseReason: config?.paused ? 'Protocol maintenance in progress' : undefined,
        version: '1.0.0',
        treasury: stats?.treasuryBalance || '0',
      },
    });
  } catch (error: any) {
    console.error('Protocol status error:', error);
    // Default to not paused if we can't fetch status
    return c.json<ApiResponse<{ 
      paused: boolean; 
      pauseReason?: string; 
      version: string; 
      treasury: string; 
    }>>({
      success: true,
      data: {
        paused: false,
        version: 'unknown',
        treasury: '0',
      },
    });
  }
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
    const adminInfo = (c as any).get('adminInfo') || { publicKey: 'unknown', ip: c.req.header('x-forwarded-for') || 'unknown' };
    
    await protocolService.pauseProtocol();
    
    // Log security event
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Protocol',
      eventType: SECURITY_EVENT_TYPES.PROTOCOL_PAUSED,
      message: 'Protocol paused by admin',
      details: {
        adminPublicKey: adminInfo.publicKey,
        timestamp: new Date().toISOString(),
      },
      source: 'protocol-api',
      userId: adminInfo.publicKey,
      ip: adminInfo.ip,
    });
    
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
    const adminInfo = (c as any).get('adminInfo') || { publicKey: 'unknown', ip: c.req.header('x-forwarded-for') || 'unknown' };
    
    await protocolService.resumeProtocol();
    
    // Log security event
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Protocol',
      eventType: SECURITY_EVENT_TYPES.PROTOCOL_RESUMED,
      message: 'Protocol resumed by admin',
      details: {
        adminPublicKey: adminInfo.publicKey,
        timestamp: new Date().toISOString(),
      },
      source: 'protocol-api',
      userId: adminInfo.publicKey,
      ip: adminInfo.ip,
    });
    
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
      const adminInfo = (c as any).get('adminInfo') || { publicKey: 'unknown', ip: c.req.header('x-forwarded-for') || 'unknown' };
      
      await protocolService.updateTokenConfig(body);
      
      // Log security event
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Protocol',
        eventType: SECURITY_EVENT_TYPES.PROTOCOL_CONFIG_CHANGED,
        message: `Token configuration updated for ${body.mint}`,
        details: {
          adminPublicKey: adminInfo.publicKey,
          tokenMint: body.mint,
          changes: body,
          timestamp: new Date().toISOString(),
        },
        source: 'protocol-api',
        userId: adminInfo.publicKey,
        ip: adminInfo.ip,
      });
      
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
      const adminInfo = (c as any).get('adminInfo') || { publicKey: 'unknown', ip: c.req.header('x-forwarded-for') || 'unknown' };
      
      const txSignature = await protocolService.withdrawTreasury(amount);
      
      // Log security event
      await securityMonitor.log({
        severity: 'CRITICAL',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_WITHDRAWAL,
        message: `Admin treasury withdrawal: ${amount} SOL`,
        details: {
          adminPublicKey: adminInfo.publicKey,
          amount,
          txSignature,
          timestamp: new Date().toISOString(),
        },
        source: 'protocol-api',
        userId: adminInfo.publicKey,
        ip: adminInfo.ip,
        txSignature,
      });
      
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