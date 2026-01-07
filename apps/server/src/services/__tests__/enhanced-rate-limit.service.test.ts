import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { EnhancedRateLimitService } from '../enhanced-rate-limit.service.js';
import { securityMonitor } from '../security-monitor.service.js';

// Mock Redis
vi.mock('ioredis');

// Mock security monitor
vi.mock('../security-monitor.service.js', () => ({
  securityMonitor: {
    log: vi.fn()
  }
}));

describe('EnhancedRateLimitService', () => {
  let mockRedis: any;
  let service: EnhancedRateLimitService;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create mock Redis instance
    mockRedis = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      ttl: vi.fn().mockResolvedValue(60),
      setex: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      sadd: vi.fn().mockResolvedValue(1),
      scard: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([])
    };
    
    // Create service instance
    service = new EnhancedRateLimitService(mockRedis as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkGlobalRateLimit', () => {
    it('should allow requests under the global limit', async () => {
      mockRedis.incr.mockResolvedValue(5000);
      
      const result = await service.checkGlobalRateLimit();
      
      expect(result.allowed).toBe(true);
      expect(result.limitType).toBe('global');
      expect(result.limit).toBe(10000);
      expect(result.remaining).toBe(5000);
    });

    it('should block requests exceeding the global limit', async () => {
      mockRedis.incr.mockResolvedValue(10001);
      
      const result = await service.checkGlobalRateLimit();
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Global rate limit exceeded');
      expect(result.limitType).toBe('global');
      expect(result.remaining).toBe(0);
      expect(securityMonitor.log).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'HIGH',
          eventType: expect.stringContaining('GLOBAL_RATE_LIMIT_EXCEEDED')
        })
      );
    });

    it('should fail open on Redis errors', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis error'));
      
      const result = await service.checkGlobalRateLimit();
      
      expect(result.allowed).toBe(true);
      expect(securityMonitor.log).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'MEDIUM',
          eventType: expect.stringContaining('RATE_LIMIT_ERROR')
        })
      );
    });
  });

  describe('checkIpRateLimit', () => {
    it('should allow requests under the IP limit', async () => {
      mockRedis.incr.mockResolvedValue(50);
      
      const result = await service.checkIpRateLimit('192.168.1.1');
      
      expect(result.allowed).toBe(true);
      expect(result.limitType).toBe('ip');
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(50);
    });

    it('should block requests exceeding the IP limit', async () => {
      mockRedis.incr.mockResolvedValue(101);
      
      const result = await service.checkIpRateLimit('192.168.1.1');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('IP rate limit exceeded');
      expect(result.limitType).toBe('ip');
    });

    it('should check ban status before rate limit', async () => {
      mockRedis.exists.mockResolvedValue(1); // IP is banned
      mockRedis.ttl.mockResolvedValue(300); // 5 minutes left
      
      const result = await service.checkIpRateLimit('192.168.1.1');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('IP is temporarily banned');
      expect(result.limitType).toBe('ban');
      expect(result.retryAfterMs).toBe(300000);
    });
  });

  describe('checkWalletRateLimit', () => {
    it('should allow requests under the wallet limit', async () => {
      mockRedis.incr.mockResolvedValue(25);
      
      const result = await service.checkWalletRateLimit('wallet123', '192.168.1.1');
      
      expect(result.allowed).toBe(true);
      expect(result.limitType).toBe('wallet');
      expect(result.limit).toBe(50);
      expect(result.remaining).toBe(25);
    });

    it('should block requests exceeding the wallet limit', async () => {
      mockRedis.incr.mockResolvedValue(51);
      
      const result = await service.checkWalletRateLimit('wallet123', '192.168.1.1');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Wallet rate limit exceeded');
      expect(result.limitType).toBe('wallet');
    });

    it('should track IP rotation for wallets', async () => {
      mockRedis.incr.mockResolvedValue(51); // Exceed limit
      mockRedis.scard.mockResolvedValue(6); // 6 different IPs
      
      await service.checkWalletRateLimit('wallet123', '192.168.1.1');
      
      expect(mockRedis.sadd).toHaveBeenCalled();
      expect(securityMonitor.log).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'HIGH',
          eventType: expect.stringContaining('SUSPICIOUS_ACTIVITY'),
          message: expect.stringContaining('using 6 different IPs')
        })
      );
    });
  });

  describe('recordViolation', () => {
    it('should apply progressive bans after threshold', async () => {
      mockRedis.incr.mockResolvedValue(3); // 3rd violation
      
      await service.recordViolation('192.168.1.1', 'ip');
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'ban:ip:192.168.1.1',
        60, // 1 minute ban for first offense
        '1'
      );
      expect(securityMonitor.log).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'MEDIUM',
          eventType: expect.stringContaining('PROGRESSIVE_BAN_APPLIED')
        })
      );
    });

    it('should increase ban duration with more violations', async () => {
      mockRedis.incr.mockResolvedValue(5); // 5th violation
      
      await service.recordViolation('192.168.1.1', 'ip');
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'ban:ip:192.168.1.1',
        900, // 15 minutes ban (3rd level)
        '1'
      );
    });

    it('should cap ban duration at maximum', async () => {
      mockRedis.incr.mockResolvedValue(20); // Many violations
      
      await service.recordViolation('192.168.1.1', 'ip');
      
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'ban:ip:192.168.1.1',
        86400, // 24 hours max ban
        '1'
      );
    });
  });

  describe('getBanDuration', () => {
    it('should return correct ban durations', () => {
      expect(service.getBanDuration(0)).toBe(60 * 1000); // 1 minute
      expect(service.getBanDuration(1)).toBe(5 * 60 * 1000); // 5 minutes
      expect(service.getBanDuration(2)).toBe(15 * 60 * 1000); // 15 minutes
      expect(service.getBanDuration(3)).toBe(60 * 60 * 1000); // 1 hour
      expect(service.getBanDuration(4)).toBe(24 * 60 * 60 * 1000); // 24 hours
      expect(service.getBanDuration(10)).toBe(24 * 60 * 60 * 1000); // Cap at 24 hours
    });
  });

  describe('clearRateLimitData', () => {
    it('should clear all rate limit data for an identifier', async () => {
      mockRedis.keys.mockResolvedValueOnce(['ip:rate-limit:192.168.1.1:123'])
        .mockResolvedValueOnce(['violations:ip:192.168.1.1'])
        .mockResolvedValueOnce(['ban:ip:192.168.1.1'])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      
      await service.clearRateLimitData('192.168.1.1', 'ip');
      
      expect(mockRedis.del).toHaveBeenCalledTimes(3);
      expect(mockRedis.del).toHaveBeenCalledWith('ip:rate-limit:192.168.1.1:123');
      expect(mockRedis.del).toHaveBeenCalledWith('violations:ip:192.168.1.1');
      expect(mockRedis.del).toHaveBeenCalledWith('ban:ip:192.168.1.1');
    });
  });

  describe('Edge cases', () => {
    it('should handle first request correctly', async () => {
      mockRedis.incr.mockResolvedValue(1);
      
      const result = await service.checkGlobalRateLimit();
      
      expect(result.allowed).toBe(true);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('global:rate-limit:'),
        60
      );
    });

    it('should handle wallet and IP ban checks independently', async () => {
      // Wallet is banned but IP is not
      mockRedis.exists
        .mockResolvedValueOnce(1) // wallet banned
        .mockResolvedValueOnce(0); // IP not banned
      mockRedis.ttl.mockResolvedValue(300);
      
      const result = await service.checkWalletRateLimit('wallet123', '192.168.1.1');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Wallet is temporarily banned');
    });
  });
});