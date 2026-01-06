import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { 
  sanitizeErrorMessage, 
  sanitizeErrorForLogging,
  createSafeErrorResponse,
  mapPrismaError,
} from '../errorSanitizer.js';

describe('errorSanitizer', () => {
  describe('sanitizeErrorMessage', () => {
    test('removes Linux file paths', () => {
      const message = 'Error at /home/deploy/apps/server/src/index.ts:45:12';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('/home/');
      expect(result).not.toContain('.ts:45');
    });
    
    test('removes Windows file paths', () => {
      const message = 'Error at C:\\Users\\Admin\\project\\src\\index.ts';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('C:\\');
    });
    
    test('removes API keys', () => {
      const message = 'Jupiter API error: api_key=jup_abc123xyz789def456ghi';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('jup_abc123');
    });
    
    test('removes database connection strings', () => {
      const message = 'Connection failed: postgresql://user:password@localhost:5432/db';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('postgresql://');
      expect(result).not.toContain('password');
    });
    
    test('removes bearer tokens', () => {
      const message = 'Auth failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('eyJhbGc');
    });
    
    test('maps Prisma errors to safe messages', () => {
      expect(sanitizeErrorMessage('PrismaClientKnownRequestError: ...')).toBe('Database error occurred');
    });
    
    test('maps connection errors to safe messages', () => {
      expect(sanitizeErrorMessage('ECONNREFUSED 127.0.0.1:5432')).toBe('Service temporarily unavailable');
    });
    
    test('maps Solana errors to safe messages', () => {
      expect(sanitizeErrorMessage('Blockhash not found')).toBe('Transaction expired, please retry');
    });
    
    test('keeps safe messages unchanged', () => {
      expect(sanitizeErrorMessage('Invalid token address')).toBe('Invalid token address');
      expect(sanitizeErrorMessage('Unauthorized')).toBe('Unauthorized');
    });
    
    test('truncates long messages', () => {
      const longMessage = 'A'.repeat(500);
      const result = sanitizeErrorMessage(longMessage);
      expect(result.length).toBeLessThanOrEqual(203); // 200 + '...'
    });
    
    test('handles null/undefined', () => {
      expect(sanitizeErrorMessage(null)).toBe('An error occurred');
      expect(sanitizeErrorMessage(undefined)).toBe('An error occurred');
      expect(sanitizeErrorMessage('')).toBe('An error occurred');
    });
  });
  
  describe('createSafeErrorResponse', () => {
    const originalEnv = process.env.NODE_ENV;
    
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });
    
    test('excludes debug info in production', () => {
      process.env.NODE_ENV = 'production';
      
      const error = new Error('/home/user/secret_file.ts failed');
      const response = createSafeErrorResponse(error, 'req-123');
      
      expect(response.debug).toBeUndefined();
      expect(response.requestId).toBe('req-123');
      expect(response.error).not.toContain('/home/');
    });
    
    test('includes debug info in development', () => {
      process.env.NODE_ENV = 'development';
      
      const error = new Error('Test error');
      const response = createSafeErrorResponse(error, 'req-123');
      
      expect(response.debug).toBeDefined();
      expect(response.debug?.message).toBe('Test error');
    });
  });
  
  describe('mapPrismaError', () => {
    test('maps unique constraint error', () => {
      const result = mapPrismaError({ code: 'P2002' });
      expect(result.message).toBe('A record with this value already exists');
      expect(result.status).toBe(409);
    });
    
    test('maps not found error', () => {
      const result = mapPrismaError({ code: 'P2025' });
      expect(result.message).toBe('Record not found');
      expect(result.status).toBe(404);
    });
    
    test('returns generic for unknown codes', () => {
      const result = mapPrismaError({ code: 'P9999' });
      expect(result.message).toBe('Database error occurred');
      expect(result.status).toBe(500);
    });
  });
});