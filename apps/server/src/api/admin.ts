import { Hono } from 'hono';
import { PublicKey } from '@solana/web3.js';
import { requireAdminApiKey } from '../middleware/adminApiKey.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getProgram } from '../services/solana.service.js';
import { getAdminKeypair } from '../config/keys.js';
import { treasuryHealthService } from '../services/treasury-health.service.js';
import { getWalletRateLimitStatus, resetWalletRateLimit } from '../services/wallet-rate-limit.service.js';
import { getCircuitBreakerStatus, resetCircuitBreaker } from '../services/circuit-breaker.service.js';
import { getAllExposures } from '../services/exposure-monitor.service.js';
import { getRecentLiquidations } from '../services/liquidation-tracker.service.js';
import { prisma } from '../db/client.js';
import type { ApiResponse } from '@memecoin-lending/types';

export const adminRouter = new Hono();

// All routes require admin API key
adminRouter.use('/*', requireAdminApiKey);

// ============ Token Management ============

// Blacklist a token
adminRouter.post('/tokens/:mint/blacklist', async (c) => {
  const mint = c.req.param('mint');
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason || 'Manual blacklist by admin';
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  
  try {
    const program = getProgram();
    const admin = getAdminKeypair();
    
    const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');
    const TOKEN_CONFIG_SEED = Buffer.from('token_config');
    
    const [protocolStatePda] = PublicKey.findProgramAddressSync(
      [PROTOCOL_STATE_SEED],
      program.programId
    );
    
    const [tokenConfigPda] = PublicKey.findProgramAddressSync(
      [TOKEN_CONFIG_SEED, new PublicKey(mint).toBuffer()],
      program.programId
    );
    
    const tx = await program.methods
      .blacklistToken()
      .accounts({
        protocolState: protocolStatePda,
        tokenConfig: tokenConfigPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    
    // Update database
    await prisma.token.updateMany({
      where: { id: mint },
      data: { blacklisted: true, blacklistReason: reason },
    });
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Admin',
      eventType: SECURITY_EVENT_TYPES.ADMIN_BLACKLIST_TOKEN,
      message: `Token ${mint} blacklisted by admin`,
      details: { mint, reason, adminKey, txSignature: tx },
      source: 'admin-api',
    });
    
    return c.json<ApiResponse<any>>({
      success: true,
      data: { message: 'Token blacklisted', mint, txSignature: tx },
    });
    
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 500);
  }
});

// Unblacklist a token
adminRouter.post('/tokens/:mint/unblacklist', async (c) => {
  const mint = c.req.param('mint');
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  
  try {
    const program = getProgram();
    const admin = getAdminKeypair();
    
    const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');
    const TOKEN_CONFIG_SEED = Buffer.from('token_config');
    
    const [protocolStatePda] = PublicKey.findProgramAddressSync(
      [PROTOCOL_STATE_SEED],
      program.programId
    );
    
    const [tokenConfigPda] = PublicKey.findProgramAddressSync(
      [TOKEN_CONFIG_SEED, new PublicKey(mint).toBuffer()],
      program.programId
    );
    
    const tx = await program.methods
      .unblacklistToken()
      .accounts({
        protocolState: protocolStatePda,
        tokenConfig: tokenConfigPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    
    // Update database
    await prisma.token.updateMany({
      where: { id: mint },
      data: { blacklisted: false, blacklistReason: null },
    });
    
    await securityMonitor.log({
      severity: 'MEDIUM',
      category: 'Admin',
      eventType: SECURITY_EVENT_TYPES.ADMIN_UNBLACKLIST_TOKEN,
      message: `Token ${mint} unblacklisted by admin`,
      details: { mint, adminKey, txSignature: tx },
      source: 'admin-api',
    });
    
    return c.json<ApiResponse<any>>({
      success: true,
      data: { message: 'Token unblacklisted', mint, txSignature: tx },
    });
    
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 500);
  }
});

// Get blacklisted tokens
adminRouter.get('/tokens/blacklisted', async (c) => {
  const tokens = await prisma.token.findMany({
    where: { blacklisted: true },
    select: {
      id: true,
      symbol: true,
      name: true,
      blacklistReason: true,
      updatedAt: true,
    },
  });
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: tokens,
  });
});

// ============ Protocol Control ============

// Get protocol status (comprehensive dashboard)
adminRouter.get('/status', async (c) => {
  const [
    circuitBreaker,
    treasury,
    exposures,
    recentLiquidations,
    activeLoansCount,
    totalLoansCount,
  ] = await Promise.all([
    getCircuitBreakerStatus(),
    treasuryHealthService.getStatus(),
    getAllExposures(),
    getRecentLiquidations(10),
    prisma.loan.count({ where: { status: 'Active' } }),
    prisma.loan.count(),
  ]);
  
  const warningExposures = exposures.filter(e => e.warningLevel !== 'none');
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: {
      circuitBreaker: {
        isTripped: circuitBreaker.isTripped,
        reason: circuitBreaker.reason,
        metrics: {
          loss24hSol: Number(circuitBreaker.metrics.loss24h) / 1e9,
          loss1hSol: Number(circuitBreaker.metrics.loss1h) / 1e9,
          liquidationCount1h: circuitBreaker.metrics.liquidationCount1h,
        },
      },
      treasury,
      exposure: {
        tokensTracked: exposures.length,
        warnings: warningExposures.length,
        warningTokens: warningExposures.map(e => ({
          symbol: e.tokenSymbol,
          mint: e.tokenMint,
          exposurePct: e.exposureBps / 100,
          level: e.warningLevel,
        })),
      },
      loans: {
        active: activeLoansCount,
        total: totalLoansCount,
      },
      recentLiquidations: recentLiquidations.slice(0, 5).map(l => ({
        tokenSymbol: l.tokenSymbol,
        lossPct: l.lossBps / 100,
        autoBlacklisted: l.autoBlacklisted,
        timestamp: l.timestamp,
      })),
    },
  });
});

// Reset circuit breaker
adminRouter.post('/circuit-breaker/reset', async (c) => {
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  
  await resetCircuitBreaker(adminKey);
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: { message: 'Circuit breaker reset' },
  });
});

// ============ Wallet Management ============

// Get wallet rate limit status
adminRouter.get('/wallets/:address/rate-limit', async (c) => {
  const address = c.req.param('address');
  const status = await getWalletRateLimitStatus(address);
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: status,
  });
});

// Reset wallet rate limit
adminRouter.post('/wallets/:address/rate-limit/reset', async (c) => {
  const address = c.req.param('address');
  const adminKey = c.req.header('X-Admin-Key') || 'unknown';
  
  await resetWalletRateLimit(address);
  
  await securityMonitor.log({
    severity: 'MEDIUM',
    category: 'Admin',
    eventType: 'ADMIN_RATE_LIMIT_RESET',
    message: `Rate limit reset for wallet ${address.slice(0, 8)}...`,
    details: { walletAddress: address, adminKey },
    source: 'admin-api',
  });
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: { message: 'Rate limit reset', walletAddress: address },
  });
});

// Get wallet info (loans, activity)
adminRouter.get('/wallets/:address', async (c) => {
  const address = c.req.param('address');
  
  const [loans, rateLimit] = await Promise.all([
    prisma.loan.findMany({
      where: { borrower: address },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { token: { select: { symbol: true, id: true } } },
    }),
    getWalletRateLimitStatus(address),
  ]);
  
  const activeLoans = loans.filter(l => l.status === 'Active');
  const liquidatedLoans = loans.filter(l => l.status === 'Liquidated');
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: {
      address,
      rateLimit,
      stats: {
        totalLoans: loans.length,
        activeLoans: activeLoans.length,
        liquidatedLoans: liquidatedLoans.length,
      },
      recentLoans: loans.slice(0, 10).map(l => ({
        id: l.id,
        tokenSymbol: l.token?.symbol,
        status: l.status,
        solBorrowed: Number(BigInt(l.solBorrowed)) / 1e9,
        createdAt: l.createdAt,
      })),
    },
  });
});

// ============ Treasury ============

// Get treasury status
adminRouter.get('/treasury', async (c) => {
  const status = treasuryHealthService.getStatus();
  return c.json<ApiResponse<any>>({
    success: true,
    data: status,
  });
});

// Force treasury health check
adminRouter.post('/treasury/check', async (c) => {
  const status = await treasuryHealthService.forceCheck();
  return c.json<ApiResponse<any>>({
    success: true,
    data: status,
  });
});

// ============ Security Events ============

// Get recent security events
adminRouter.get('/security/events', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const severity = c.req.query('severity'); // optional filter
  
  const where: any = {};
  if (severity) {
    where.severity = severity.toUpperCase();
  }
  
  const events = await prisma.securityEvent.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: events,
  });
});

// Test Telegram alert
adminRouter.post('/security/test-alert', async (c) => {
  const result = await securityMonitor.testAlerts();
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: result,
  });
});