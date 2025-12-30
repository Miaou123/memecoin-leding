import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { manualWhitelistService } from '../../services/manual-whitelist.service';
import { logger } from '../../utils/logger';
import { TokenTier } from '@memecoin-lending/types';

const app = new Hono();

// Admin authentication middleware (implement based on your auth system)
const requireAdmin = async (c: any, next: any) => {
  // Get admin address from headers or token
  const adminAddress = c.req.header('x-admin-address');
  const signature = c.req.header('x-signature');
  
  if (!adminAddress || !signature) {
    return c.json({ 
      success: false, 
      error: 'Admin authentication required' 
    }, 401);
  }
  
  // TODO: Implement signature verification for admin auth
  // For now, just check if it's a valid address format
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(adminAddress)) {
    return c.json({ 
      success: false, 
      error: 'Invalid admin address' 
    }, 401);
  }
  
  c.set('adminAddress', adminAddress);
  await next();
};

// Validation schemas
const createWhitelistSchema = z.object({
  mint: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
  symbol: z.string().optional(),
  name: z.string().optional(),
  tier: z.enum(['bronze', 'silver', 'gold']),
  ltvBps: z.number().min(1000).max(9000).optional(), // 10% to 90%
  interestRateBps: z.number().min(100).max(2000).optional(), // 1% to 20%
  minLoanAmount: z.string().optional(),
  maxLoanAmount: z.string().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  externalUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
});

const updateWhitelistSchema = z.object({
  symbol: z.string().optional(),
  name: z.string().optional(),
  tier: z.enum(['bronze', 'silver', 'gold']).optional(),
  ltvBps: z.number().min(1000).max(9000).optional(),
  interestRateBps: z.number().min(100).max(2000).optional(),
  minLoanAmount: z.string().optional(),
  maxLoanAmount: z.string().optional(),
  enabled: z.boolean().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  externalUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
});

const getWhitelistSchema = z.object({
  mint: z.string().optional(),
  tier: z.enum(['bronze', 'silver', 'gold']).optional(),
  enabled: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  addedBy: z.string().optional(),
  tags: z.string().optional().transform(val => val ? val.split(',') : undefined),
  search: z.string().optional(),
  sortBy: z.enum(['addedAt', 'updatedAt', 'symbol', 'tier']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.string().optional().transform(val => val ? parseInt(val) : undefined),
  limit: z.string().optional().transform(val => val ? parseInt(val) : undefined),
});

/**
 * POST /admin/whitelist - Add token to manual whitelist
 */
app.post(
  '/',
  requireAdmin,
  validator('json', (value, c) => {
    const result = createWhitelistSchema.safeParse(value);
    if (!result.success) {
      return c.json({
        success: false,
        error: 'Invalid request data',
        details: result.error.issues,
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const adminAddress = c.get('adminAddress' as never) as string;
      const data = c.req.valid('json');

      logger.info(`Admin ${adminAddress} adding token ${data.mint} to whitelist`);

      const entry = await manualWhitelistService.addToWhitelist(
        {
          ...data,
          tier: data.tier as TokenTier,
        },
        adminAddress
      );

      return c.json({
        success: true,
        data: entry,
      });
    } catch (error) {
      logger.error('Add to whitelist error:', error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * GET /admin/whitelist - Get whitelist entries with filters
 */
app.get(
  '/',
  requireAdmin,
  validator('query', (value, c) => {
    const result = getWhitelistSchema.safeParse(value);
    if (!result.success) {
      return c.json({
        success: false,
        error: 'Invalid query parameters',
        details: result.error.issues,
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const filters = c.req.valid('query');

      logger.info(`Getting whitelist entries with filters:`, filters);

      const result = await manualWhitelistService.getWhitelistEntries({
        filters: {
          mint: filters.mint,
          tier: filters.tier as TokenTier,
          enabled: filters.enabled,
          addedBy: filters.addedBy,
          tags: filters.tags,
          search: filters.search,
        },
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        page: filters.page,
        limit: filters.limit,
      });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Get whitelist entries error:', error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * GET /admin/whitelist/stats - Get whitelist statistics
 */
app.get('/stats', requireAdmin, async (c) => {
  try {
    const stats = await manualWhitelistService.getWhitelistStats();

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get whitelist stats error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /admin/whitelist/:mint - Get specific whitelist entry
 */
app.get('/:mint', requireAdmin, async (c) => {
  try {
    const { mint } = c.req.param();

    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    const entry = await manualWhitelistService.getWhitelistEntry(mint);

    if (!entry) {
      return c.json({
        success: false,
        error: 'Token not found in whitelist',
      }, 404);
    }

    return c.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Get whitelist entry error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * PUT /admin/whitelist/:mint - Update whitelist entry
 */
app.put(
  '/:mint',
  requireAdmin,
  validator('json', (value, c) => {
    const result = updateWhitelistSchema.safeParse(value);
    if (!result.success) {
      return c.json({
        success: false,
        error: 'Invalid request data',
        details: result.error.issues,
      }, 400);
    }
    return result.data;
  }),
  async (c) => {
    try {
      const { mint } = c.req.param();
      const adminAddress = c.get('adminAddress' as never) as string;
      const data = c.req.valid('json');

      if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
        return c.json({
          success: false,
          error: 'Invalid mint address',
        }, 400);
      }

      logger.info(`Admin ${adminAddress} updating whitelist entry for ${mint}`);

      const entry = await manualWhitelistService.updateWhitelistEntry(
        mint,
        {
          ...data,
          tier: data.tier as TokenTier,
        },
        adminAddress
      );

      return c.json({
        success: true,
        data: entry,
      });
    } catch (error) {
      logger.error('Update whitelist entry error:', error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);

/**
 * POST /admin/whitelist/:mint/enable - Enable whitelist entry
 */
app.post('/:mint/enable', requireAdmin, async (c) => {
  try {
    const { mint } = c.req.param();
    const adminAddress = c.get('adminAddress' as never) as string;

    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    logger.info(`Admin ${adminAddress} enabling whitelist entry for ${mint}`);

    await manualWhitelistService.enableEntry(mint, adminAddress);

    return c.json({
      success: true,
      message: 'Token enabled successfully',
    });
  } catch (error) {
    logger.error('Enable whitelist entry error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /admin/whitelist/:mint/disable - Disable whitelist entry
 */
app.post('/:mint/disable', requireAdmin, async (c) => {
  try {
    const { mint } = c.req.param();
    const adminAddress = c.get('adminAddress' as never) as string;
    const body = await c.req.json().catch(() => ({}));
    const { reason } = body;

    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    logger.info(`Admin ${adminAddress} disabling whitelist entry for ${mint}`, { reason });

    await manualWhitelistService.disableEntry(mint, adminAddress, reason);

    return c.json({
      success: true,
      message: 'Token disabled successfully',
    });
  } catch (error) {
    logger.error('Disable whitelist entry error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * DELETE /admin/whitelist/:mint - Remove token from whitelist
 */
app.delete('/:mint', requireAdmin, async (c) => {
  try {
    const { mint } = c.req.param();
    const adminAddress = c.get('adminAddress' as never) as string;
    const body = await c.req.json().catch(() => ({}));
    const { reason } = body;

    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    logger.info(`Admin ${adminAddress} removing whitelist entry for ${mint}`, { reason });

    await manualWhitelistService.removeFromWhitelist(mint, adminAddress, reason);

    return c.json({
      success: true,
      message: 'Token removed from whitelist successfully',
    });
  } catch (error) {
    logger.error('Remove from whitelist error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /admin/whitelist/:mint/audit-logs - Get audit logs for a specific entry
 */
app.get('/:mint/audit-logs', requireAdmin, async (c) => {
  try {
    const { mint } = c.req.param();

    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return c.json({
        success: false,
        error: 'Invalid mint address',
      }, 400);
    }

    // First get the entry to get its ID
    const entry = await manualWhitelistService.getWhitelistEntry(mint);
    
    if (!entry) {
      return c.json({
        success: false,
        error: 'Token not found in whitelist',
      }, 404);
    }

    const logs = await manualWhitelistService.getAuditLogs(entry.id);

    return c.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error('Get audit logs error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /admin/whitelist/audit-logs/all - Get all audit logs
 */
app.get('/audit-logs/all', requireAdmin, async (c) => {
  try {
    const adminAddress = c.req.query('adminAddress');
    const limit = parseInt(c.req.query('limit') || '100');

    const logs = await manualWhitelistService.getAuditLogs(
      undefined,
      adminAddress,
      Math.min(limit, 500) // Cap at 500
    );

    return c.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error('Get all audit logs error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;