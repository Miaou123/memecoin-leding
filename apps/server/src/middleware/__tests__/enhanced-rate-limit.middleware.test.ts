import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { enhancedRateLimiter, resetRateLimitService } from '../rateLimit.js';
import { getEnhancedRateLimitService } from '../../services/enhanced-rate-limit.service.js';

// Create a mock service instance that will be reused
const mockServiceInstance = {
  checkBanStatus: vi.fn(),
  checkIpRateLimit: vi.fn(),
  checkWalletRateLimit: vi.fn(),
  checkGlobalRateLimit: vi.fn()
};

// Mock the enhanced rate limit service to always return the same instance
vi.mock('../../services/enhanced-rate-limit.service.js', () => ({
  getEnhancedRateLimitService: vi.fn(() => mockServiceInstance)
}));

// Mock the trustedProxy module
vi.mock('../trustedProxy.js', () => ({
  getIp: vi.fn(() => '192.168.1.1')
}));

describe('Enhanced Rate Limit Middleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the rate limit service to ensure it uses our mock
    resetRateLimitService();
    
    // Create mock context
    mockContext = {
      req: {
        path: '/api/test',
        method: 'GET',
        header: vi.fn()
      },
      header: vi.fn(),
      user: null
    };
    
    // Create mock next function
    mockNext = vi.fn();
  });

  describe('Unauthenticated requests', () => {
    it('should use IP-based rate limiting for unauthenticated requests', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkIpRateLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        reset: new Date(),
        limitType: 'ip'
      });

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test'
      });

      await middleware(mockContext as Context, mockNext);

      expect(mockServiceInstance.checkBanStatus).toHaveBeenCalledWith('192.168.1.1', 'ip');
      expect(mockServiceInstance.checkIpRateLimit).toHaveBeenCalledWith('192.168.1.1');
      expect(mockServiceInstance.checkWalletRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '99');
    });

    it('should block banned IPs', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({
        allowed: false,
        reason: 'IP is temporarily banned',
        retryAfterMs: 300000,
        limitType: 'ban'
      });

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test'
      });

      await expect(middleware(mockContext as Context, mockNext))
        .rejects.toThrow(HTTPException);

      expect(mockServiceInstance.checkIpRateLimit).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.header).toHaveBeenCalledWith('Retry-After', '300');
    });
  });

  describe('Authenticated requests', () => {
    beforeEach(() => {
      mockContext.user = { wallet: 'wallet123' };
    });

    it('should use wallet-based rate limiting for authenticated requests', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkWalletRateLimit.mockResolvedValue({
        allowed: true,
        limit: 50,
        remaining: 49,
        reset: new Date(),
        limitType: 'wallet'
      });

      const middleware = enhancedRateLimiter({
        requests: 50,
        windowMs: 60000,
        name: 'test',
        useWalletIfAuthenticated: true
      });

      await middleware(mockContext as Context, mockNext);

      expect(mockServiceInstance.checkBanStatus).toHaveBeenCalledWith('wallet123', 'wallet');
      expect(mockServiceInstance.checkWalletRateLimit).toHaveBeenCalledWith('wallet123', '192.168.1.1');
      expect(mockServiceInstance.checkIpRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should block banned wallets', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({
        allowed: false,
        reason: 'Wallet is temporarily banned',
        retryAfterMs: 3600000,
        limitType: 'ban'
      });

      const middleware = enhancedRateLimiter({
        requests: 50,
        windowMs: 60000,
        name: 'test',
        useWalletIfAuthenticated: true
      });

      await expect(middleware(mockContext as Context, mockNext))
        .rejects.toThrow(HTTPException);

      expect(mockServiceInstance.checkWalletRateLimit).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.header).toHaveBeenCalledWith('Retry-After', '3600');
    });

    it('should use IP-based limiting when useWalletIfAuthenticated is false', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkIpRateLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        reset: new Date(),
        limitType: 'ip'
      });

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test',
        useWalletIfAuthenticated: false
      });

      await middleware(mockContext as Context, mockNext);

      expect(mockServiceInstance.checkBanStatus).toHaveBeenCalledWith('192.168.1.1', 'ip');
      expect(mockServiceInstance.checkIpRateLimit).toHaveBeenCalledWith('192.168.1.1');
      expect(mockServiceInstance.checkWalletRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('Rate limit exceeded', () => {
    it('should throw 429 when rate limit exceeded', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkIpRateLimit.mockResolvedValue({
        allowed: false,
        reason: 'IP rate limit exceeded',
        retryAfterMs: 30000,
        limitType: 'ip',
        limit: 100,
        remaining: 0,
        reset: new Date()
      });

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test'
      });

      let error;
      try {
        await middleware(mockContext as Context, mockNext);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(429);
      expect((error as HTTPException).message).toBe('IP rate limit exceeded');
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.header).toHaveBeenCalledWith('Retry-After', '30');
    });
  });

  describe('Headers', () => {
    it('should set all rate limit headers correctly', async () => {
      const reset = new Date(Date.now() + 60000);
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkIpRateLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 75,
        reset,
        limitType: 'ip'
      });

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test'
      });

      await middleware(mockContext as Context, mockNext);

      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '75');
      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Reset', reset.toISOString());
      expect(mockContext.header).toHaveBeenCalledWith('X-RateLimit-Type', 'ip');
    });
  });

  describe('Error handling', () => {
    it('should fail open when service throws error', async () => {
      mockServiceInstance.checkBanStatus.mockRejectedValue(new Error('Redis error'));

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test'
      });

      await middleware(mockContext as Context, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should rethrow HTTPException', async () => {
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkIpRateLimit.mockRejectedValue(
        new HTTPException(500, { message: 'Internal error' })
      );

      const middleware = enhancedRateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'test'
      });

      await expect(middleware(mockContext as Context, mockNext))
        .rejects.toThrow(HTTPException);
    });
  });

  describe('Legacy compatibility', () => {
    it('should support legacy rate limiter configuration', async () => {
      const { rateLimiter } = await import('../rateLimit.js');
      
      mockServiceInstance.checkBanStatus.mockResolvedValue({ allowed: true });
      mockServiceInstance.checkIpRateLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        reset: new Date(),
        limitType: 'ip'
      });

      // User is authenticated but legacy mode should still use IP
      mockContext.user = { wallet: 'wallet123' };

      const middleware = rateLimiter({
        requests: 100,
        windowMs: 60000,
        name: 'legacy-test'
      });

      await middleware(mockContext as Context, mockNext);

      // Should use IP even though user is authenticated
      expect(mockServiceInstance.checkIpRateLimit).toHaveBeenCalledWith('192.168.1.1');
      expect(mockServiceInstance.checkWalletRateLimit).not.toHaveBeenCalled();
    });
  });
});