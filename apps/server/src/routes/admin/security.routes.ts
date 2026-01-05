import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { securityMonitor } from '../../services/security-monitor.service.js';
import { requireAdmin } from '../../middleware/auth.js';
import { prisma } from '../../db/client.js';
import type { SecuritySeverity, SecurityCategory } from '@memecoin-lending/types';

const securityRoutes = new Hono();

// Apply admin authentication to all routes
securityRoutes.use('*', requireAdmin);

// Get recent security events with filtering
securityRoutes.get('/events', 
  zValidator('query', z.object({
    limit: z.string().regex(/^\d+$/).optional().transform(v => v ? Math.min(parseInt(v), 1000) : 100),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    category: z.string().optional(),
    eventType: z.string().optional(),
    since: z.string().optional(),
  })),
  async (c) => {
    const { limit, severity, category, eventType, since } = c.req.valid('query');
    
    try {
      const filters: any = {};
      if (severity) filters.severity = severity as SecuritySeverity;
      if (category) filters.category = category as SecurityCategory;
      if (eventType) filters.eventType = eventType;
      if (since) filters.since = since;
      
      const events = securityMonitor.getRecentEvents(limit, filters);
      
      return c.json({
        success: true,
        data: events,
        count: events.length,
      });
    } catch (error: any) {
      console.error('Failed to get security events:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to retrieve security events' 
      }, 500);
    }
  }
);

// Get event statistics  
securityRoutes.get('/stats', async (c) => {
  try {
    const stats = securityMonitor.getStats();
    
    return c.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('Failed to get security stats:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to retrieve security statistics' 
    }, 500);
  }
});

// Send test alert
securityRoutes.post('/test-alert', async (c) => {
  try {
    const results = await securityMonitor.testAlerts();
    const allSuccess = Object.values(results).every(v => v === true);
    
    return c.json({
      success: allSuccess,
      results,
      message: allSuccess 
        ? 'All alert channels tested successfully' 
        : 'Some alert channels failed',
    });
  } catch (error: any) {
    console.error('Failed to test alerts:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to test alert channels' 
    }, 500);
  }
});

// Get alert configuration
securityRoutes.get('/config', async (c) => {
  try {
    const config = securityMonitor.getConfig();
    
    return c.json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    console.error('Failed to get security config:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to retrieve security configuration' 
    }, 500);
  }
});

// Clear all events (for maintenance) - disabled for production safety

// Trigger a manual security event (for testing)
securityRoutes.post('/trigger-event',
  zValidator('json', z.object({
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    category: z.string().min(1).max(50),
    eventType: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    details: z.record(z.any()).optional(),
  })),
  async (c) => {
    const { severity, category, eventType, message, details } = c.req.valid('json');
    
    try {
      await securityMonitor.log({
        severity,
        category: category as SecurityCategory,
        eventType,
        message,
        details: details || {},
        source: 'manual-trigger',
      });
      
      return c.json({
        success: true,
        message: 'Security event triggered successfully',
      });
    } catch (error: any) {
      console.error('Failed to trigger security event:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to trigger security event' 
      }, 500);
    }
  }
);

// Mark event as resolved
securityRoutes.post('/resolve/:id',
  zValidator('json', z.object({
    notes: z.string().optional(),
  })),
  async (c) => {
    const { id } = c.req.param();
    const { notes } = c.req.valid('json');
    const adminAddress = c.user?.wallet || 'unknown';
    
    try {
      await securityMonitor.resolveEvent(id, adminAddress, notes);
      
      return c.json({
        success: true,
        message: 'Event marked as resolved',
      });
    } catch (error: any) {
      console.error('Failed to resolve security event:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to resolve security event' 
      }, 500);
    }
  }
);

// Get database events (historical)
securityRoutes.get('/events/db',
  zValidator('query', z.object({
    page: z.string().regex(/^\d+$/).optional().transform(v => v ? Math.max(parseInt(v), 1) : 1),
    limit: z.string().regex(/^\d+$/).optional().transform(v => v ? Math.min(parseInt(v), 1000) : 50),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    category: z.string().optional(),
    eventType: z.string().optional(),
    resolved: z.enum(['true', 'false']).optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  })),
  async (c) => {
    const { page, limit, severity, category, eventType, resolved, since, until } = c.req.valid('query');
    
    try {
      const skip = (page - 1) * limit;
      
      const where: any = {};
      if (severity) where.severity = severity;
      if (category) where.category = category;
      if (eventType) where.eventType = eventType;
      if (resolved !== undefined) where.resolved = resolved === 'true';
      
      if (since || until) {
        where.timestamp = {};
        if (since) where.timestamp.gte = new Date(since);
        if (until) where.timestamp.lte = new Date(until);
      }
      
      const [events, total] = await Promise.all([
        prisma.securityEvent.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip,
          take: limit,
        }),
        prisma.securityEvent.count({ where }),
      ]);
      
      return c.json({
        success: true,
        data: {
          events,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error: any) {
      console.error('Failed to get database events:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to retrieve database events' 
      }, 500);
    }
  }
);

// Get dashboard summary
securityRoutes.get('/summary', async (c) => {
  try {
    const stats = securityMonitor.getStats();
    const recentCritical = securityMonitor.getRecentEvents(10, { severity: 'CRITICAL' });
    const recentHigh = securityMonitor.getRecentEvents(10, { severity: 'HIGH' });
    
    // Get database stats if enabled
    let dbStats = null;
    if (process.env.SECURITY_PERSIST_TO_DB === 'true') {
      try {
        const [totalDb, criticalDb, resolvedDb] = await Promise.all([
          prisma.securityEvent.count(),
          prisma.securityEvent.count({ where: { severity: 'CRITICAL' } }),
          prisma.securityEvent.count({ where: { resolved: true } }),
        ]);
        
        dbStats = {
          totalEvents: totalDb,
          criticalEvents: criticalDb,
          resolvedEvents: resolvedDb,
          unresolvedEvents: totalDb - resolvedDb,
        };
      } catch (error) {
        console.error('Failed to get database stats:', error);
      }
    }
    
    return c.json({
      success: true,
      data: {
        stats,
        recentCritical,
        recentHigh,
        dbStats,
        alertConfig: securityMonitor.getConfig(),
      },
    });
  } catch (error: any) {
    console.error('Failed to get security summary:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to retrieve security summary' 
    }, 500);
  }
});

export { securityRoutes };