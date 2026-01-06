import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAdmin } from '../../middleware/auth.js';
import { manualWhitelistService } from '../../services/manual-whitelist.service';
import { logger } from '../../utils/logger';
import { securityMonitor } from '../../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getIp } from '../../middleware/trustedProxy.js';
import { getRequestId } from '../../middleware/requestId.js';
import { sanitizeForLogging } from '../../utils/inputSanitizer.js';
import {
  createWhitelistEntrySchema,
  updateWhitelistEntrySchema,
  getWhitelistEntriesSchema,
  solanaAddressSchema,
} from '../../validators/index.js';

const app = new Hono();

// Apply centralized admin authentication to all routes
app.use('*', requireAdmin);

/**
 * POST / - Add token to whitelist
 */
app.post(
  '/',
  zValidator('json', createWhitelistEntrySchema),
  async (c) => {
    try {
      const adminAddress = c.user?.wallet!;
      const data = c.req.valid('json');
      // data is now fully sanitized by the schema
      
      logger.info('Admin adding token to whitelist', {
        admin: adminAddress.substring(0, 8) + '...',
        mint: data.mint.substring(0, 8) + '...',
        requestId: getRequestId(c),
      });

      const entry = await manualWhitelistService.addToWhitelist(
        data,
        adminAddress
      );

      // Security logging
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Admin',
        eventType: SECURITY_EVENT_TYPES.ADMIN_WHITELIST_ADDED,
        message: `Token whitelisted: ${data.mint.substring(0, 8)}...`,
        details: {
          mint: data.mint,
          tier: data.tier,
          addedBy: adminAddress,
        },
        source: 'admin-whitelist',
        ip: getIp(c),
        requestId: getRequestId(c),
        userId: adminAddress,
      });

      return c.json({
        success: true,
        data: entry,
      });
    } catch (error: any) {
      logger.error('Add to whitelist error', {
        error: sanitizeForLogging(error.message),
        requestId: getRequestId(c),
      });
      
      return c.json({
        success: false,
        error: error.message || 'Failed to add token to whitelist',
      }, 400);
    }
  }
);

/**
 * GET / - Get whitelist entries with filters
 */
app.get(
  '/',
  zValidator('query', getWhitelistEntriesSchema),
  async (c) => {
    try {
      const filters = c.req.valid('query');
      // filters are sanitized (search query escaped, addresses validated, etc.)
      
      const entries = await manualWhitelistService.getWhitelistEntries(filters);

      return c.json({
        success: true,
        data: entries,
      });
    } catch (error: any) {
      logger.error('Get whitelist error', {
        error: sanitizeForLogging(error.message),
        requestId: getRequestId(c),
      });
      
      return c.json({
        success: false,
        error: 'Failed to fetch whitelist entries',
      }, 500);
    }
  }
);

/**
 * GET /admin/whitelist/stats - Get whitelist statistics
 */
app.get('/stats', async (c) => {
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
app.get('/:mint', async (c) => {
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
  zValidator('param', z.object({ mint: solanaAddressSchema })),
  zValidator('json', updateWhitelistEntrySchema),
  async (c) => {
    try {
      const { mint } = c.req.valid('param');
      const adminAddress = c.user?.wallet!;
      const data = c.req.valid('json');

      logger.info(`Admin ${adminAddress} updating whitelist entry for ${mint}`);

      // SECURITY: Log whitelist update
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Admin',
        eventType: SECURITY_EVENT_TYPES.ADMIN_WHITELIST_UPDATE,
        message: `Admin updated whitelist entry: ${mint.substring(0, 8)}...`,
        details: {
          mint,
          changes: data,
          adminAddress: adminAddress.slice(0, 8) + '...',
        },
        source: 'admin-whitelist',
        ip: getIp(c),
        userId: adminAddress,
      });

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
app.post('/:mint/enable', async (c) => {
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

    // SECURITY: Log whitelist enable
    await securityMonitor.log({
      severity: 'MEDIUM',
      category: 'Admin',
      eventType: SECURITY_EVENT_TYPES.ADMIN_WHITELIST_ENABLE,
      message: `Admin enabled whitelist entry: ${mint.substring(0, 8)}...`,
      details: {
        mint,
        adminAddress: adminAddress.slice(0, 8) + '...',
        action: 'enable',
      },
      source: 'admin-whitelist',
      ip: getIp(c),
      userId: adminAddress,
    });

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
app.post('/:mint/disable', async (c) => {
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

    // SECURITY: Log whitelist disable
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Admin',
      eventType: SECURITY_EVENT_TYPES.ADMIN_WHITELIST_DISABLE,
      message: `Admin disabled whitelist entry: ${mint.substring(0, 8)}...`,
      details: {
        mint,
        adminAddress: adminAddress.slice(0, 8) + '...',
        reason,
        action: 'disable',
      },
      source: 'admin-whitelist',
      ip: getIp(c),
      userId: adminAddress,
    });

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
app.delete('/:mint', async (c) => {
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

    // SECURITY: Log whitelist removal (CRITICAL since this is permanent)
    await securityMonitor.log({
      severity: 'CRITICAL',
      category: 'Admin',
      eventType: SECURITY_EVENT_TYPES.ADMIN_WHITELIST_REMOVE,
      message: `Admin removed whitelist entry: ${mint.substring(0, 8)}...`,
      details: {
        mint,
        adminAddress: adminAddress.slice(0, 8) + '...',
        reason,
        action: 'remove',
        warning: 'PERMANENT_DELETION',
      },
      source: 'admin-whitelist',
      ip: getIp(c),
      userId: adminAddress,
    });

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
app.get('/:mint/audit-logs', async (c) => {
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
app.get('/audit-logs/all', async (c) => {
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