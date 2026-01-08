import Redis from 'ioredis';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Rate limit configuration
const MAX_LOANS_PER_HOUR = 3;
const MAX_ACTIVE_LOANS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  loansInWindow?: number;
  activeLoans?: number;
  retryAfterSeconds?: number;
}

/**
 * Check if wallet can create a new loan
 */
export async function checkWalletRateLimit(walletAddress: string): Promise<RateLimitResult> {
  const redisKey = `loan_rate:${walletAddress}`;
  
  try {
    // Check hourly rate limit
    const loansInWindowStr = await redis.get(redisKey);
    const loansInWindow = parseInt(loansInWindowStr || '0', 10);
    
    if (loansInWindow >= MAX_LOANS_PER_HOUR) {
      
      const ttl = await redis.ttl(redisKey);
      const minutes = Math.ceil(ttl / 60);
      
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Rate Limiting',
        eventType: SECURITY_EVENT_TYPES.WALLET_RATE_LIMITED,
        message: `Wallet ${walletAddress.slice(0, 8)}... hit hourly loan limit`,
        details: {
          walletAddress,
          loansInWindow,
          limit: MAX_LOANS_PER_HOUR,
          windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
          retryAfterSeconds: ttl,
        },
        source: 'wallet-rate-limit',
        userId: walletAddress,
      });
      
      return {
        allowed: false,
        reason: `You can only create ${MAX_LOANS_PER_HOUR} loans per hour. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before creating another loan.`,
        loansInWindow,
        retryAfterSeconds: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS,
      };
    }
    
    // Check active loans limit
    const activeLoans = await prisma.loan.count({
      where: {
        borrower: walletAddress,
        status: 'Active',
      },
    });
    
    if (activeLoans >= MAX_ACTIVE_LOANS) {
      
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Rate Limiting',
        eventType: SECURITY_EVENT_TYPES.WALLET_MAX_LOANS_EXCEEDED,
        message: `Wallet ${walletAddress.slice(0, 8)}... has max active loans`,
        details: {
          walletAddress,
          activeLoans,
          limit: MAX_ACTIVE_LOANS,
        },
        source: 'wallet-rate-limit',
        userId: walletAddress,
      });
      
      return {
        allowed: false,
        reason: `You have reached the maximum of ${MAX_ACTIVE_LOANS} active loans. Please repay an existing loan before creating a new one.`,
        activeLoans,
      };
    }
    
    return {
      allowed: true,
      loansInWindow,
      activeLoans,
    };
    
  } catch (error: any) {
    console.error('[WalletRateLimit] Check failed:', error.message);
    // Fail open - allow the loan if rate limiting fails
    return { allowed: true };
  }
}

/**
 * Get wallet rate limit status (for API)
 */
export async function getWalletRateLimitStatus(walletAddress: string): Promise<{
  loansInWindow: number;
  maxLoansPerHour: number;
  activeLoans: number;
  maxActiveLoans: number;
  canCreateLoan: boolean;
  retryAfterSeconds?: number;
}> {
  const redisKey = `loan_rate:${walletAddress}`;
  
  const [loansInWindowStr, ttl, activeLoans] = await Promise.all([
    redis.get(redisKey),
    redis.ttl(redisKey),
    prisma.loan.count({
      where: {
        borrower: walletAddress,
        status: 'Active',
      },
    }),
  ]);
  
  const loansInWindow = parseInt(loansInWindowStr || '0', 10);
  const canCreateLoan = loansInWindow < MAX_LOANS_PER_HOUR && activeLoans < MAX_ACTIVE_LOANS;
  
  return {
    loansInWindow,
    maxLoansPerHour: MAX_LOANS_PER_HOUR,
    activeLoans,
    maxActiveLoans: MAX_ACTIVE_LOANS,
    canCreateLoan,
    retryAfterSeconds: loansInWindow >= MAX_LOANS_PER_HOUR && ttl > 0 ? ttl : undefined,
  };
}

/**
 * Reset rate limit for a wallet (admin only)
 */
export async function resetWalletRateLimit(walletAddress: string): Promise<void> {
  const redisKey = `loan_rate:${walletAddress}`;
  await redis.del(redisKey);
}

/**
 * Record a successful loan creation (call ONLY after loan is confirmed on-chain)
 */
export async function recordSuccessfulLoan(walletAddress: string): Promise<void> {
  const redisKey = `loan_rate:${walletAddress}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, RATE_LIMIT_WINDOW_SECONDS);
  }
  console.log(`[WalletRateLimit] Recorded successful loan for ${walletAddress.slice(0, 8)}..., count: ${count}/${MAX_LOANS_PER_HOUR}`);
}