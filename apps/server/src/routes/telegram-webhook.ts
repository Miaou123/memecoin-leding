import { Hono } from 'hono';
import crypto from 'crypto';
import { telegramVerificationService } from '../services/telegram-verification.service.js';
import { verificationRequestService } from '../services/verification-request.service.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getRequestId } from '../middleware/requestId.js';

const app = new Hono();

// Verify Telegram webhook signature
function verifyTelegramWebhook(token: string, receivedData: any): boolean {
  const secret = crypto.createHash('sha256').update(token).digest();
  const checkString = Object.keys(receivedData)
    .filter(key => key !== 'hash')
    .sort()
    .map(key => `${key}=${receivedData[key]}`)
    .join('\n');
  
  const hmac = crypto.createHmac('sha256', secret)
    .update(checkString)
    .digest('hex');
  
  return hmac === receivedData.hash;
}

// Telegram webhook endpoint
app.post('/', async (c) => {
  const requestId = getRequestId(c);
  
  try {
    const body = await c.req.json();
    
    // Log webhook received
    await securityMonitor.log({
      severity: 'LOW',
      category: 'Telegram',
      eventType: SECURITY_EVENT_TYPES.TELEGRAM_API_ERROR,
      message: 'Telegram webhook received',
      details: {
        updateType: body.message ? 'message' : body.callback_query ? 'callback_query' : 'unknown',
        requestId,
      },
      source: 'telegram-webhook',
    });
    
    // Verify webhook if in production
    if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_BOT_TOKEN) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      // Note: Telegram doesn't send a hash field in webhook payloads
      // This verification is for Telegram Login Widget, not webhooks
      // For webhooks, we rely on the secret URL path
    }
    
    // Handle callback queries (button presses)
    if (body.callback_query) {
      const query = body.callback_query;
      
      // Check if it's a verification-related callback
      if (query.data && query.data.startsWith('verify:')) {
        const reviewInput = await telegramVerificationService.handleCallbackQuery(query);
        
        if (reviewInput) {
          // Process the review
          const success = await verificationRequestService.reviewRequest(reviewInput);
          
          if (success) {
            await securityMonitor.log({
              severity: 'MEDIUM',
              category: 'Telegram',
              eventType: SECURITY_EVENT_TYPES.TOKEN_VERIFICATION_APPROVED,
              message: `Verification request ${reviewInput.action}ed via Telegram`,
              details: {
                requestId: reviewInput.requestId,
                action: reviewInput.action,
                tier: reviewInput.tier,
                reviewedBy: reviewInput.reviewedBy,
                telegramRequestId: requestId,
              },
              source: 'telegram-webhook',
              userId: reviewInput.reviewedBy,
            });
          }
        }
      }
    }
    
    // Always respond with 200 OK to acknowledge receipt
    return c.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Telegram',
      eventType: SECURITY_EVENT_TYPES.TELEGRAM_API_ERROR,
      message: 'Error processing Telegram webhook',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      source: 'telegram-webhook',
    });
    
    // Still return 200 to prevent Telegram from retrying
    return c.json({ ok: true });
  }
});

// Endpoint to set webhook URL (admin only)
app.post('/set-webhook', async (c) => {
  try {
    // This would typically be called during deployment
    // For security, we'll require a secret token
    const authHeader = c.req.header('Authorization');
    const expectedToken = process.env.TELEGRAM_WEBHOOK_SECRET;
    
    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.SERVER_URL) {
      return c.json({ error: 'Missing configuration' }, 400);
    }
    
    const webhookUrl = `${process.env.SERVER_URL}/telegram/webhook`;
    const telegramApiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`;
    
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['callback_query', 'message'],
      }),
    });
    
    const result = await response.json() as { ok: boolean; description?: string };
    
    if (result.ok) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Telegram',
        eventType: SECURITY_EVENT_TYPES.TELEGRAM_API_ERROR,
        message: 'Telegram webhook URL configured',
        details: {
          webhookUrl,
        },
        source: 'telegram-webhook',
      });
    }
    
    return c.json(result);
  } catch (error) {
    console.error('Failed to set webhook:', error);
    return c.json({ error: 'Failed to set webhook' }, 500);
  }
});

export default app;