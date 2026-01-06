import { PublicKey } from '@solana/web3.js';
import { prisma } from '../db/client.js';
import { priceService } from './price.service.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface LPLimitCheck {
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  maxUsage: number;
  lpValue: number;
  isProtocolToken: boolean;
}

interface TokenLPData {
  mint: string;
  lpValueUSD: number;
  totalActiveLoansUSD: number;
  usagePercent: number;
  maxPercent: number;
  timestamp: number;
}

class LPLimitsService {
  private readonly LP_CACHE_TTL = 60; // 60 seconds cache for LP values
  private readonly PROTOCOL_TOKEN_MINT = process.env.PROTOCOL_TOKEN_MINT || '';
  private readonly DEFAULT_LP_LIMIT_PERCENT = 0.20; // 20%
  private readonly PROTOCOL_TOKEN_LP_LIMIT_PERCENT = 0.50; // 50%

  /**
   * Check if a new loan would exceed LP limits
   */
  async checkLPLimits(tokenMint: string, newLoanAmountSOL: string): Promise<LPLimitCheck> {
    try {
      // Check if this is the protocol token
      const isProtocolToken = tokenMint === this.PROTOCOL_TOKEN_MINT;
      const maxPercent = isProtocolToken ? this.PROTOCOL_TOKEN_LP_LIMIT_PERCENT : this.DEFAULT_LP_LIMIT_PERCENT;

      // Get token LP value
      const lpValueUSD = await this.getTokenLPValue(tokenMint);
      if (lpValueUSD === 0) {
        return {
          allowed: false,
          reason: 'Unable to determine token liquidity pool value',
          currentUsage: 0,
          maxUsage: 0,
          lpValue: 0,
          isProtocolToken,
        };
      }

      // Get current active loans for this token
      const totalActiveLoansSOL = await this.getTotalActiveLoansSOL(tokenMint);
      
      // Convert new loan amount to USD
      const solPrice = await priceService.getSolPrice();
      const newLoanAmountUSD = (parseFloat(newLoanAmountSOL) / 1e9) * solPrice;
      const totalActiveLoansUSD = (Number(totalActiveLoansSOL) / 1e9) * solPrice;

      // Calculate usage with new loan
      const projectedTotalUSD = totalActiveLoansUSD + newLoanAmountUSD;
      const projectedUsagePercent = projectedTotalUSD / lpValueUSD;

      // Check if it would exceed limit
      if (projectedUsagePercent > maxPercent) {
        const currentUsagePercent = totalActiveLoansUSD / lpValueUSD;
        
        // Log security event
        await securityMonitor.log({
          severity: 'HIGH',
          category: 'Loans',
          eventType: SECURITY_EVENT_TYPES.LOAN_LP_LIMIT_EXCEEDED,
          message: `Loan rejected: Would exceed ${maxPercent * 100}% LP limit for ${isProtocolToken ? 'protocol token' : 'token'}`,
          details: {
            tokenMint,
            isProtocolToken,
            lpValueUSD,
            currentUsagePercent: currentUsagePercent * 100,
            projectedUsagePercent: projectedUsagePercent * 100,
            maxPercent: maxPercent * 100,
            newLoanAmountUSD,
            totalActiveLoansUSD,
          },
          source: 'lp-limits-service',
        });

        return {
          allowed: false,
          reason: `Cannot create loan: Would exceed ${maxPercent * 100}% of token's liquidity pool value. Current usage: ${(currentUsagePercent * 100).toFixed(2)}%`,
          currentUsage: totalActiveLoansUSD,
          maxUsage: lpValueUSD * maxPercent,
          lpValue: lpValueUSD,
          isProtocolToken,
        };
      }

      return {
        allowed: true,
        currentUsage: totalActiveLoansUSD,
        maxUsage: lpValueUSD * maxPercent,
        lpValue: lpValueUSD,
        isProtocolToken,
      };
    } catch (error: any) {
      console.error('[LPLimits] Error checking LP limits:', error);
      
      // Log the error but don't block loans on service failure
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Loans',
        eventType: SECURITY_EVENT_TYPES.LOAN_LP_CHECK_FAILED,
        message: 'Failed to check LP limits, allowing loan to proceed',
        details: {
          tokenMint,
          error: error.message,
        },
        source: 'lp-limits-service',
      });

      // Allow loan to proceed on error (fail open for now)
      return {
        allowed: true,
        currentUsage: 0,
        maxUsage: 0,
        lpValue: 0,
        isProtocolToken: tokenMint === this.PROTOCOL_TOKEN_MINT,
      };
    }
  }

  /**
   * Get token's liquidity pool value in USD
   */
  private async getTokenLPValue(tokenMint: string): Promise<number> {
    // Check cache first
    const cacheKey = `lp_value:${tokenMint}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return parseFloat(cached);
    }

    try {
      // Get from price service (which fetches from DexScreener)
      const priceData = await priceService.getExtendedPriceData(tokenMint);
      const lpValue = priceData.liquidity?.usd || 0;

      // Cache the value
      if (lpValue > 0) {
        await redis.set(cacheKey, lpValue.toString(), 'EX', this.LP_CACHE_TTL);
      }

      return lpValue;
    } catch (error: any) {
      console.error('[LPLimits] Error fetching LP value:', error);
      
      // Try to get from database as fallback
      const token = await prisma.token.findUnique({
        where: { id: tokenMint },
        select: { poolLiquidity: true },
      });

      if (token?.poolLiquidity) {
        // Convert from lamports to USD (this is stored as SOL value in lamports)
        const solPrice = await priceService.getSolPrice();
        return (parseFloat(token.poolLiquidity) / 1e9) * solPrice;
      }

      return 0;
    }
  }

  /**
   * Get total active loans for a token in SOL (lamports)
   */
  private async getTotalActiveLoansSOL(tokenMint: string): Promise<bigint> {
    const loans = await prisma.loan.findMany({
      where: {
        tokenMint,
        status: 'active',
      },
      select: {
        solBorrowed: true,
      },
    });

    return loans.reduce((total, loan) => total + BigInt(loan.solBorrowed), 0n);
  }

  /**
   * Get LP usage stats for monitoring
   */
  async getTokenLPUsage(tokenMint: string): Promise<TokenLPData | null> {
    try {
      const lpValueUSD = await this.getTokenLPValue(tokenMint);
      if (!lpValueUSD) return null;

      const totalActiveLoansSOL = await this.getTotalActiveLoansSOL(tokenMint);
      const solPrice = await priceService.getSolPrice();
      const totalActiveLoansUSD = (Number(totalActiveLoansSOL) / 1e9) * solPrice;

      const isProtocolToken = tokenMint === this.PROTOCOL_TOKEN_MINT;
      const maxPercent = isProtocolToken ? this.PROTOCOL_TOKEN_LP_LIMIT_PERCENT : this.DEFAULT_LP_LIMIT_PERCENT;

      return {
        mint: tokenMint,
        lpValueUSD,
        totalActiveLoansUSD,
        usagePercent: (totalActiveLoansUSD / lpValueUSD) * 100,
        maxPercent: maxPercent * 100,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      console.error('[LPLimits] Error getting LP usage:', error);
      return null;
    }
  }

  /**
   * Monitor all tokens for LP limit warnings
   */
  async monitorLPLimits(): Promise<void> {
    try {
      // Get all unique token mints with active loans
      const activeTokens = await prisma.loan.groupBy({
        by: ['tokenMint'],
        where: { status: 'active' },
      });

      for (const { tokenMint } of activeTokens) {
        const usage = await this.getTokenLPUsage(tokenMint);
        if (!usage) continue;

        // Warn at 80% of limit
        const warningThreshold = usage.maxPercent * 0.8;
        
        if (usage.usagePercent >= warningThreshold) {
          await securityMonitor.log({
            severity: usage.usagePercent >= usage.maxPercent ? 'CRITICAL' : 'HIGH',
            category: 'Loans',
            eventType: SECURITY_EVENT_TYPES.LOAN_LP_LIMIT_WARNING,
            message: `Token approaching LP limit: ${usage.usagePercent.toFixed(2)}% of ${usage.maxPercent}% limit`,
            details: {
              tokenMint,
              lpValueUSD: usage.lpValueUSD,
              totalActiveLoansUSD: usage.totalActiveLoansUSD,
              usagePercent: usage.usagePercent,
              maxPercent: usage.maxPercent,
              warningThreshold,
            },
            source: 'lp-limits-monitor',
          });
        }
      }
    } catch (error: any) {
      console.error('[LPLimits] Monitoring error:', error);
    }
  }
}

export const lpLimitsService = new LPLimitsService();