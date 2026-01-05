import { Hono } from 'hono';
import { prepareLoanTransaction, PrepareLoanRequest } from '../services/loan-prepare.service.js';
import { getPriceAuthorityPublicKey } from '../config/keys.js';

export const loanPrepareRouter = new Hono();

/**
 * POST /api/loan/prepare
 * 
 * Prepares a loan transaction with backend price approval.
 * The backend fetches the price from Jupiter and signs the transaction.
 */
loanPrepareRouter.post('/prepare', async (c) => {
  try {
    const body = await c.req.json() as PrepareLoanRequest;

    // Validate request
    if (!body.tokenMint || !body.collateralAmount || !body.durationSeconds || !body.borrower) {
      return c.json({
        success: false,
        error: 'Missing required fields: tokenMint, collateralAmount, durationSeconds, borrower',
      }, 400);
    }

    // Validate duration (12 hours to 7 days)
    const MIN_DURATION = 12 * 60 * 60; // 12 hours
    const MAX_DURATION = 7 * 24 * 60 * 60; // 7 days
    
    if (body.durationSeconds < MIN_DURATION || body.durationSeconds > MAX_DURATION) {
      return c.json({
        success: false,
        error: `Duration must be between ${MIN_DURATION} and ${MAX_DURATION} seconds`,
      }, 400);
    }

    // Validate collateral amount is positive
    if (BigInt(body.collateralAmount) <= 0n) {
      return c.json({
        success: false,
        error: 'Collateral amount must be positive',
      }, 400);
    }

    console.log(`[API] Preparing loan for ${body.borrower.slice(0, 8)}...`);
    console.log(`[API] - Token: ${body.tokenMint.slice(0, 8)}...`);
    console.log(`[API] - Collateral: ${body.collateralAmount}`);
    console.log(`[API] - Duration: ${body.durationSeconds}s`);

    const result = await prepareLoanTransaction(body);

    return c.json({
      success: true,
      data: result,
    });

  } catch (error: any) {
    console.error('[API] Prepare loan error:', error);
    
    // Handle specific errors
    if (error.message.includes('Jupiter')) {
      return c.json({
        success: false,
        error: 'Unable to fetch token price. Please try again.',
        details: error.message,
      }, 503);
    }

    if (error.message.includes('not found') || error.message.includes('Account does not exist')) {
      return c.json({
        success: false,
        error: 'Token not whitelisted or account not found',
        details: error.message,
      }, 404);
    }

    return c.json({
      success: false,
      error: 'Failed to prepare loan transaction',
      details: error.message,
    }, 500);
  }
});

/**
 * GET /api/loan/price-authority
 * 
 * Returns the price authority public key (for debugging/verification)
 */
loanPrepareRouter.get('/price-authority', async (c) => {
  try {
    const publicKey = getPriceAuthorityPublicKey();
    return c.json({
      success: true,
      data: {
        priceAuthority: publicKey,
      },
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: 'Price authority not configured',
    }, 500);
  }
});