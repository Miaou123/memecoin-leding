import { Hono } from 'hono';
import { requireAdminApiKey } from '../../middleware/adminApiKey.js';
import type { FeeClaimerService } from '../../services/fee-claimer.service.js';

// We'll inject this from the main server
let feeClaimerService: FeeClaimerService | null = null;

export function setFeeClaimerService(service: FeeClaimerService) {
  feeClaimerService = service;
}

const adminFeesRouter = new Hono();

// Apply admin auth to all routes
adminFeesRouter.use('/*', requireAdminApiKey);

/**
 * POST /api/admin/fees/claim
 * Manually trigger fee claim and distribution
 */
adminFeesRouter.post('/claim', async (c) => {
  if (!feeClaimerService) {
    return c.json({ 
      success: false, 
      error: 'Fee claimer service not initialized' 
    }, 503);
  }
  
  try {
    const result = await feeClaimerService.manualClaim();
    
    return c.json({
      success: result.success,
      claimed: result.claimed,
      distributed: result.distributed,
      breakdown: result.breakdown,
      signatures: result.signatures,
      timestamp: new Date().toISOString(),
      error: result.error,
    });
  } catch (error: any) {
    console.error('Manual fee claim error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to claim fees' 
    }, 500);
  }
});

/**
 * GET /api/admin/fees/balances
 * Get all fee-related balances
 */
adminFeesRouter.get('/balances', async (c) => {
  if (!feeClaimerService) {
    return c.json({ 
      success: false, 
      error: 'Fee claimer service not initialized' 
    }, 503);
  }
  
  try {
    const balances = await feeClaimerService.getBalances();
    
    return c.json({
      ...balances,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get fee balances error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to get balances' 
    }, 500);
  }
});

/**
 * GET /api/admin/fees/status
 * Get claimer service status
 */
adminFeesRouter.get('/status', async (c) => {
  if (!feeClaimerService) {
    return c.json({ 
      success: false, 
      error: 'Fee claimer service not initialized',
      enabled: false,
      running: false,
    }, 503);
  }
  
  try {
    const status = feeClaimerService.getStatus();
    
    return c.json({
      ...status,
      lastClaimAttempt: status.lastClaimAttempt?.toISOString(),
    });
  } catch (error: any) {
    console.error('Get fee status error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to get status' 
    }, 500);
  }
});

export default adminFeesRouter;