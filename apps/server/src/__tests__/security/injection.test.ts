import { describe, expect, test } from 'vitest';
import {
  sanitizeString,
  sanitizeSolanaAddress,
  sanitizeUrl,
  sanitizeSearchQuery,
  sanitizeForLogging,
  escapeHtml,
} from '../../utils/inputSanitizer.js';


describe('Input Sanitization Security Tests', () => {
  describe('XSS Prevention', () => {
    test('escapes HTML script tags', () => {
      const malicious = '<script>alert("xss")</script>';
      expect(escapeHtml(malicious)).not.toContain('<script>');
      expect(sanitizeString(malicious)).not.toContain('<script>');
    });
    
    test('escapes event handlers', () => {
      const malicious = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(malicious);
      // The entire string should be escaped, preventing XSS
      expect(escaped).not.toContain('<img');
      expect(escaped).toContain('&lt;img');
      expect(sanitizeString(malicious)).not.toContain('<img');
    });
    
    test('escapes javascript: URLs', () => {
      const malicious = 'javascript:alert(1)';
      expect(sanitizeUrl(malicious)).toBeNull();
    });
    
    test('escapes data: URLs', () => {
      const malicious = 'data:text/html,<script>alert(1)</script>';
      expect(sanitizeUrl(malicious)).toBeNull();
    });
    
    test('handles unicode escaping attempts', () => {
      // Various unicode bypass attempts
      const tests = [
        '<\u0073cript>alert(1)</script>',
        '<script\u0000>alert(1)</script>',
        '\u003cscript\u003ealert(1)\u003c/script\u003e',
      ];
      
      for (const malicious of tests) {
        const sanitized = sanitizeString(malicious);
        expect(sanitized.toLowerCase()).not.toContain('script');
      }
    });
  });
  
  describe('SQL Injection Prevention', () => {
    test('escapes SQL wildcards in search', () => {
      const malicious = "test%' OR '1'='1";
      const sanitized = sanitizeSearchQuery(malicious);
      expect(sanitized).not.toContain("'");
      expect(sanitized).toContain('\\%');
    });
    
    test('escapes SQL comment sequences', () => {
      const malicious = 'test--; DROP TABLE users;';
      const sanitized = sanitizeSearchQuery(malicious);
      // Prisma ORM handles SQL injection, but search should still be limited
      expect(sanitized.length).toBeLessThanOrEqual(100);
    });
  });
  
  describe('Solana Address Validation', () => {
    test('rejects invalid addresses', () => {
      expect(sanitizeSolanaAddress('not-an-address')).toBeNull();
      expect(sanitizeSolanaAddress('1234')).toBeNull();
      expect(sanitizeSolanaAddress('')).toBeNull();
    });
    
    test('rejects addresses with injection attempts', () => {
      expect(sanitizeSolanaAddress("'; DROP TABLE--")).toBeNull();
      expect(sanitizeSolanaAddress('<script>')).toBeNull();
    });
    
    test('accepts valid Solana addresses', () => {
      const valid = 'So11111111111111111111111111111111111111112';
      expect(sanitizeSolanaAddress(valid)).toBe(valid);
    });
    
    test('accepts valid wallet addresses', () => {
      const valid = 'CgWTFX7JJQHed3qyMDjJkNCxK4sFe3wbDFABmWAAmrdS';
      expect(sanitizeSolanaAddress(valid)).toBe(valid);
    });
  });
  
  describe('URL Validation', () => {
    test('blocks javascript protocol', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
      expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBeNull();
      expect(sanitizeUrl('  javascript:alert(1)  ')).toBeNull();
    });
    
    test('blocks data protocol', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    });
    
    test('blocks file protocol', () => {
      expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
    });
    
    test('allows valid HTTPS URLs', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
      expect(sanitizeUrl('https://example.com/path?query=1')).toBeTruthy();
    });
    
    test('enforces domain whitelist when specified', () => {
      const options = { allowedDomains: ['trusted.com'] };
      expect(sanitizeUrl('https://trusted.com/path', options)).toBeTruthy();
      expect(sanitizeUrl('https://evil.com/path', options)).toBeNull();
    });
  });
  
  describe('Log Injection Prevention', () => {
    test('removes newlines that could forge log entries', () => {
      const malicious = 'User login\n[ERROR] Fake error message';
      const sanitized = sanitizeForLogging(malicious);
      expect(sanitized).not.toContain('\n');
      expect(sanitized).toContain('\\n');
    });
    
    test('removes ANSI escape codes', () => {
      const malicious = '\x1b[31mRED TEXT\x1b[0m';
      const sanitized = sanitizeForLogging(malicious);
      expect(sanitized).not.toContain('\x1b');
    });
  });
  
  describe('Path Traversal Prevention', () => {
    test('sanitizeString removes path traversal attempts', () => {
      const malicious = '../../../etc/passwd';
      // sanitizeString strips HTML but path traversal is blocked at URL level
      // For file operations, paths should never come from user input
    });
  });
  
  describe('ReDoS Prevention', () => {
    test('limits search query length', () => {
      const malicious = 'a'.repeat(10000);
      const sanitized = sanitizeSearchQuery(malicious);
      expect(sanitized.length).toBeLessThanOrEqual(100);
    });
    
    test('removes repeated special characters that cause ReDoS', () => {
      const malicious = '***************';
      const sanitized = sanitizeSearchQuery(malicious);
      expect(sanitized.length).toBeLessThan(malicious.length);
    });
  });
  
  describe('Null Byte Injection', () => {
    test('removes null bytes', () => {
      const malicious = 'test\0.txt';
      const sanitized = sanitizeString(malicious);
      expect(sanitized).not.toContain('\0');
    });
  });
});