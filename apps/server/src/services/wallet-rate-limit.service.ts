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
    const loansInWindow = await redis.incr(redisKey);
    
    if (loansInWindow === 1) {
      // First loan in window, set expiry
      await redis.expire(redisKey, RATE_LIMIT_WINDOW_SECONDS);
    }
    
    if (loansInWindow > MAX_LOANS_PER_HOUR) {
      // Decrement since we're rejecting
      await redis.decr(redisKey);
      
      const ttl = await redis.ttl(redisKey);
      
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
        reason: `Rate limit exceeded. Max ${MAX_LOANS_PER_HOUR} loans per hour.`,
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
      // Decrement since we're rejecting
      await redis.decr(redisKey);
      
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
        reason: `Max active loans exceeded. You have ${activeLoans}/${MAX_ACTIVE_LOANS} active loans.`,
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