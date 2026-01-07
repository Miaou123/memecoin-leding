import Redis from 'ioredis';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

export interface RateLimitConfig {
  globalLimit: number;           // 10000 requests/minute
  globalWindowMs: number;        // 60000 ms (1 minute)
  ipLimit: number;               // 100 requests/minute
  ipWindowMs: number;            // 60000 ms (1 minute)
  walletLimit: number;           // 50 requests/minute
  walletWindowMs: number;        // 60000 ms (1 minute)
  enableProgressiveBans: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  limitType?: 'global' | 'ip' | 'wallet' | 'ban';
  limit?: number;
  remaining?: number;
  reset?: Date;
}

// Ban durations in milliseconds
const BAN_DURATIONS = [
  60 * 1000,        // 1 minute
  5 * 60 * 1000,    // 5 minutes
  15 * 60 * 1000,   // 15 minutes
  60 * 60 * 1000,   // 1 hour
  24 * 60 * 60 * 1000  // 24 hours
];

export class EnhancedRateLimitService {
  private redis: Redis;
  private config: RateLimitConfig;

  constructor(redis: Redis, config?: Partial<RateLimitConfig>) {
    this.redis = redis;
    this.config = {
      globalLimit: 10000,
      globalWindowMs: 60000,
      ipLimit: 100,
      ipWindowMs: 60000,
      walletLimit: 50,
      walletWindowMs: 60000,
      enableProgressiveBans: true,
      ...config
    };
  }

  /**
   * Check global protocol-wide rate limit
   */
  async checkGlobalRateLimit(): Promise<RateLimitResult> {
    try {
      const minuteBucket = this.getMinuteBucket();
      const key = `global:rate-limit:${minuteBucket}`;
      
      // Increment and get the count
      const count = await this.redis.incr(key);
      
      // Set expiry on first request
      if (count === 1) {
        await this.redis.expire(key, Math.ceil(this.config.globalWindowMs / 1000));
      }
      
      const remaining = Math.max(0, this.config.globalLimit - count);
      const reset = new Date(minuteBucket + this.config.globalWindowMs);
      
      if (count > this.config.globalLimit) {
        const retryAfterMs = reset.getTime() - Date.now();
        
        // Log global rate limit exceeded
        await securityMonitor.log({
          severity: 'HIGH',
          category: 'Rate Limiting',
          eventType: SECURITY_EVENT_TYPES.GLOBAL_RATE_LIMIT_EXCEEDED,
          message: `Global rate limit exceeded: ${count}/${this.config.globalLimit} requests`,
          details: {
            count,
            limit: this.config.globalLimit,
            minuteBucket,
            retryAfterMs
          },
          source: 'enhanced-rate-limit',
        });
        
        return {
          allowed: false,
          reason: 'Global rate limit exceeded',
          retryAfterMs,
          limitType: 'global',
          limit: this.config.globalLimit,
          remaining: 0,
          reset
        };
      }
      
      return {
        allowed: true,
        limitType: 'global',
        limit: this.config.globalLimit,
        remaining,
        reset
      };
    } catch (error) {
      // Fail open on Redis errors
      console.error('Global rate limit check failed:', error);
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Rate Limiting',
        eventType: SECURITY_EVENT_TYPES.RATE_LIMIT_ERROR,
        message: 'Global rate limit check failed - failing open',
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
        source: 'enhanced-rate-limit',
      });
      
      return { allowed: true };
    }
  }

  /**
   * Check IP-based rate limit (for unauthenticated endpoints)
   */
  async checkIpRateLimit(ip: string): Promise<RateLimitResult> {
    try {
      // First check if banned
      const banCheck = await this.checkBanStatus(ip, 'ip');
      if (!banCheck.allowed) {
        return banCheck;
      }
      
      const minuteBucket = this.getMinuteBucket();
      const key = `ip:rate-limit:${ip}:${minuteBucket}`;
      
      // Increment and get the count
      const count = await this.redis.incr(key);
      
      // Set expiry on first request
      if (count === 1) {
        await this.redis.expire(key, Math.ceil(this.config.ipWindowMs / 1000));
      }
      
      const remaining = Math.max(0, this.config.ipLimit - count);
      const reset = new Date(minuteBucket + this.config.ipWindowMs);
      
      if (count > this.config.ipLimit) {
        const retryAfterMs = reset.getTime() - Date.now();
        
        // Record violation for progressive bans
        if (this.config.enableProgressiveBans) {
          await this.recordViolation(ip, 'ip');
        }
        
        return {
          allowed: false,
          reason: `IP rate limit exceeded`,
          retryAfterMs,
          limitType: 'ip',
          limit: this.config.ipLimit,
          remaining: 0,
          reset
        };
      }
      
      return {
        allowed: true,
        limitType: 'ip',
        limit: this.config.ipLimit,
        remaining,
        reset
      };
    } catch (error) {
      // Fail open on Redis errors
      console.error('IP rate limit check failed:', error);
      return { allowed: true };
    }
  }

  /**
   * Check wallet-based rate limit (for authenticated endpoints)
   */
  async checkWalletRateLimit(wallet: string, ip: string): Promise<RateLimitResult> {
    try {
      // First check if wallet is banned
      const walletBanCheck = await this.checkBanStatus(wallet, 'wallet');
      if (!walletBanCheck.allowed) {
        return walletBanCheck;
      }
      
      // Also check if IP is banned
      const ipBanCheck = await this.checkBanStatus(ip, 'ip');
      if (!ipBanCheck.allowed) {
        return ipBanCheck;
      }
      
      const minuteBucket = this.getMinuteBucket();
      // Use wallet as primary key, but track IP for security
      const key = `wallet:rate-limit:${wallet}:${minuteBucket}`;
      const compositeKey = `wallet-ip:${wallet}:${ip}:${minuteBucket}`;
      
      // Increment both wallet and wallet-ip counters
      const [walletCount, compositeCount] = await Promise.all([
        this.redis.incr(key),
        this.redis.incr(compositeKey)
      ]);
      
      // Set expiry on first request
      if (walletCount === 1) {
        await this.redis.expire(key, Math.ceil(this.config.walletWindowMs / 1000));
      }
      if (compositeCount === 1) {
        await this.redis.expire(compositeKey, Math.ceil(this.config.walletWindowMs / 1000));
      }
      
      const remaining = Math.max(0, this.config.walletLimit - walletCount);
      const reset = new Date(minuteBucket + this.config.walletWindowMs);
      
      if (walletCount > this.config.walletLimit) {
        const retryAfterMs = reset.getTime() - Date.now();
        
        // Record violation for progressive bans
        if (this.config.enableProgressiveBans) {
          await this.recordViolation(wallet, 'wallet');
          
          // Also track IP if wallet is rotating IPs suspiciously
          const ipRotationKey = `wallet-ips:${wallet}:${minuteBucket}`;
          await this.redis.sadd(ipRotationKey, ip);
          await this.redis.expire(ipRotationKey, 3600); // 1 hour TTL
          const ipCount = await this.redis.scard(ipRotationKey);
          
          if (ipCount > 5) { // More than 5 different IPs per minute is suspicious
            await securityMonitor.log({
              severity: 'HIGH',
              category: 'Rate Limiting',
              eventType: SECURITY_EVENT_TYPES.SUSPICIOUS_ACTIVITY,
              message: `Wallet ${wallet.substring(0, 8)}... using ${ipCount} different IPs`,
              details: {
                wallet,
                ipCount,
                currentIp: ip
              },
              source: 'enhanced-rate-limit',
            });
          }
        }
        
        return {
          allowed: false,
          reason: `Wallet rate limit exceeded`,
          retryAfterMs,
          limitType: 'wallet',
          limit: this.config.walletLimit,
          remaining: 0,
          reset
        };
      }
      
      return {
        allowed: true,
        limitType: 'wallet',
        limit: this.config.walletLimit,
        remaining,
        reset
      };
    } catch (error) {
      // Fail open on Redis errors
      console.error('Wallet rate limit check failed:', error);
      return { allowed: true };
    }
  }

  /**
   * Check if an identifier (IP or wallet) is banned
   */
  async checkBanStatus(identifier: string, type: 'ip' | 'wallet'): Promise<RateLimitResult> {
    try {
      const banKey = `ban:${type}:${identifier}`;
      const banned = await this.redis.exists(banKey);
      
      if (banned) {
        const ttl = await this.redis.ttl(banKey);
        const retryAfterMs = ttl * 1000;
        
        return {
          allowed: false,
          reason: `${type === 'ip' ? 'IP' : 'Wallet'} is temporarily banned`,
          retryAfterMs,
          limitType: 'ban',
          limit: 0,
          remaining: 0,
          reset: new Date(Date.now() + retryAfterMs)
        };
      }
      
      return { allowed: true };
    } catch (error) {
      console.error('Ban status check failed:', error);
      return { allowed: true }; // Fail open
    }
  }

  /**
   * Record a rate limit violation and potentially apply progressive ban
   */
  async recordViolation(identifier: string, type: 'ip' | 'wallet'): Promise<void> {
    try {
      const violationKey = `violations:${type}:${identifier}`;
      const violationCount = await this.redis.incr(violationKey);
      
      // Set TTL on first violation (24 hours)
      if (violationCount === 1) {
        await this.redis.expire(violationKey, 86400);
      }
      
      // Determine if we should apply a ban
      const banThreshold = 3; // Start banning after 3 violations
      if (violationCount >= banThreshold) {
        const banIndex = Math.min(violationCount - banThreshold, BAN_DURATIONS.length - 1);
        const banDuration = this.getBanDuration(violationCount - banThreshold);
        
        const banKey = `ban:${type}:${identifier}`;
        await this.redis.setex(banKey, Math.ceil(banDuration / 1000), '1');
        
        // Log progressive ban
        await securityMonitor.log({
          severity: violationCount > 5 ? 'HIGH' : 'MEDIUM',
          category: 'Rate Limiting',
          eventType: SECURITY_EVENT_TYPES.PROGRESSIVE_BAN_APPLIED,
          message: `Progressive ban applied to ${type}: ${identifier.substring(0, 8)}...`,
          details: {
            identifier,
            type,
            violationCount,
            banDurationMs: banDuration,
            banLevel: banIndex + 1
          },
          source: 'enhanced-rate-limit',
        });
        
        // Reset violation count after applying max ban
        if (banIndex >= BAN_DURATIONS.length - 1) {
          await this.redis.del(violationKey);
        }
      }
      
      // Log repeated violations
      if (violationCount > 1) {
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Rate Limiting',
          eventType: SECURITY_EVENT_TYPES.REPEATED_VIOLATION_DETECTED,
          message: `Repeated rate limit violation from ${type}: ${identifier.substring(0, 8)}...`,
          details: {
            identifier,
            type,
            violationCount
          },
          source: 'enhanced-rate-limit',
        });
      }
    } catch (error) {
      console.error('Failed to record violation:', error);
    }
  }

  /**
   * Get ban duration based on violation count
   */
  getBanDuration(violationCount: number): number {
    const index = Math.min(violationCount, BAN_DURATIONS.length - 1);
    return BAN_DURATIONS[index];
  }

  /**
   * Get the current minute bucket (timestamp rounded to minute)
   */
  private getMinuteBucket(): number {
    const now = Date.now();
    return Math.floor(now / 60000) * 60000;
  }

  /**
   * Clear all rate limit data for an identifier (for testing or admin use)
   */
  async clearRateLimitData(identifier: string, type: 'ip' | 'wallet'): Promise<void> {
    const patterns = [
      `${type}:rate-limit:${identifier}:*`,
      `violations:${type}:${identifier}`,
      `ban:${type}:${identifier}`,
      `wallet-ip:${identifier}:*:*`,
      `wallet-ips:${identifier}:*`
    ];
    
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }
}

// Singleton instance
let enhancedRateLimitService: EnhancedRateLimitService | null = null;

export function getEnhancedRateLimitService(redis?: Redis, config?: Partial<RateLimitConfig>): EnhancedRateLimitService {
  if (!enhancedRateLimitService) {
    if (!redis) {
      throw new Error('Redis instance required for first initialization');
    }
    enhancedRateLimitService = new EnhancedRateLimitService(redis, config);
  }
  return enhancedRateLimitService;
}