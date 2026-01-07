import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { verificationRequestService } from '../services/verification-request.service.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import type { 
  CreateVerificationRequestInput,
  ReviewVerificationRequestInput,
} from '@memecoin-lending/types';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

const app = new Hono();

// Create a verification request (requires auth)
app.post('/', requireAuth, async (c) => {
  const requestId = c.get('requestId');
  const wallet = c.user!.wallet;
  
  try {
    const body = await c.req.json<Omit<CreateVerificationRequestInput, 'requestedBy'>>();
    
    if (!body.mint) {
      return c.json({ error: 'Token mint is required' }, 400);
    }
    
    // Validate mint format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.mint)) {
      return c.json({ error: 'Invalid token mint format' }, 400);
    }
    
    const result = await verificationRequestService.createRequest({
      mint: body.mint,
      requestedBy: wallet,
      reason: body.reason,
    });
    
    if (!result.success) {
      return c.json({ 
        error: result.error,
        alreadyRequested: result.alreadyRequested,
      }, 400);
    }
    
    return c.json({
      success: true,
      requestId: result.requestId,
    });
  } catch (error) {
    console.error('Failed to create verification request:', error);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'API',
      eventType: SECURITY_EVENT_TYPES.API_ERROR,
      message: 'Error creating verification request',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        wallet,
        requestId,
      },
      source: 'verification-request-api',
      userId: wallet,
    });
    
    return c.json({ error: 'Failed to create verification request' }, 500);
  }
});

// Get user's verification requests (requires auth)
app.get('/my-requests', requireAuth, async (c) => {
  const wallet = c.user!.wallet;
  
  try {
    const requests = await verificationRequestService.getUserRequests(wallet);
    return c.json({ requests });
  } catch (error) {
    console.error('Failed to get user requests:', error);
    return c.json({ error: 'Failed to get requests' }, 500);
  }
});

// Admin: Get all pending requests
app.get('/pending', requireAdmin, async (c) => {
  try {
    const requests = await verificationRequestService.getPendingRequests();
    return c.json({ requests });
  } catch (error) {
    console.error('Failed to get pending requests:', error);
    return c.json({ error: 'Failed to get requests' }, 500);
  }
});

// Admin: Review a request
app.post('/review', requireAdmin, async (c) => {
  const adminWallet = c.user!.wallet;
  const requestId = c.get('requestId');
  
  try {
    const body = await c.req.json<Omit<ReviewVerificationRequestInput, 'reviewedBy'>>();
    
    if (!body.requestId || !body.action) {
      return c.json({ error: 'Request ID and action are required' }, 400);
    }
    
    if (body.action !== 'approve' && body.action !== 'reject') {
      return c.json({ error: 'Invalid action. Must be approve or reject' }, 400);
    }
    
    if (body.action === 'approve' && !body.tier) {
      return c.json({ error: 'Tier is required for approval' }, 400);
    }
    
    const success = await verificationRequestService.reviewRequest({
      requestId: body.requestId,
      action: body.action,
      adminResponse: body.adminResponse,
      reviewedBy: adminWallet,
      tier: body.tier,
    });
    
    if (!success) {
      return c.json({ error: 'Failed to review request' }, 400);
    }
    
    await securityMonitor.log({
      severity: 'MEDIUM',
      category: 'Admin',
      eventType: 'VERIFICATION_REQUEST_REVIEWED',
      message: `Admin ${body.action}ed verification request`,
      details: {
        requestId: body.requestId,
        action: body.action,
        tier: body.tier,
        adminWallet,
        apiRequestId: requestId,
      },
      source: 'verification-request-api',
      userId: adminWallet,
    });
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to review request:', error);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Admin',
      eventType: 'VERIFICATION_REVIEW_ERROR',
      message: 'Error reviewing verification request',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        adminWallet,
        requestId,
      },
      source: 'verification-request-api',
      userId: adminWallet,
    });
    
    return c.json({ error: 'Failed to review request' }, 500);
  }
});

// Admin: Expire old requests (can be called by cron job)
app.post('/expire', requireAdmin, async (c) => {
  const adminWallet = c.user!.wallet;
  
  try {
    const count = await verificationRequestService.expireOldRequests();
    
    if (count > 0) {
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Admin',
        eventType: 'VERIFICATION_REQUESTS_EXPIRED',
        message: `Expired ${count} old verification requests`,
        details: {
          count,
          adminWallet,
        },
        source: 'verification-request-api',
        userId: adminWallet,
      });
    }
    
    return c.json({ 
      success: true, 
      expiredCount: count,
    });
  } catch (error) {
    console.error('Failed to expire requests:', error);
    return c.json({ error: 'Failed to expire requests' }, 500);
  }
});

export default app;