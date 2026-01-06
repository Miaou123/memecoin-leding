/**
 * Input Sanitization Library
 * Protects against XSS, injection, and other input-based attacks
 */

import { PublicKey } from '@solana/web3.js';

// ============================================
// STRING SANITIZATION
// ============================================

/**
 * HTML-escape a string to prevent XSS
 * Use when displaying user input in HTML contexts
 */
export function escapeHtml(input: string): string {
  if (!input) return '';
  
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  
  // First replace & to avoid double escaping
  return input
    .replace(/&/g, '&amp;')
    .replace(/[<>"'`=/]/g, char => htmlEscapes[char])
    // Also escape common event handler patterns
    .replace(/on\w+\s*=/gi, 'on_$&');
}

/**
 * Remove all HTML tags from input
 */
export function stripHtml(input: string): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Sanitize a string for safe storage/display
 * - Trims whitespace
 * - Removes null bytes
 * - Normalizes unicode
 * - Limits length
 */
export function sanitizeString(
  input: string | undefined | null,
  options: {
    maxLength?: number;
    allowNewlines?: boolean;
    allowHtml?: boolean;
  } = {}
): string {
  if (!input) return '';
  
  const { maxLength = 1000, allowNewlines = false, allowHtml = false } = options;
  
  let sanitized = input
    // Remove null bytes (can bypass security checks)
    .replace(/\0/g, '')
    // Normalize unicode (prevents homograph attacks)
    .normalize('NFC')
    // Trim whitespace
    .trim();
  
  // Remove or escape HTML
  if (!allowHtml) {
    sanitized = stripHtml(sanitized);
  }
  
  // Handle newlines
  if (!allowNewlines) {
    sanitized = sanitized.replace(/[\r\n]+/g, ' ');
  }
  
  // Enforce max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

// ============================================
// SOLANA ADDRESS VALIDATION
// ============================================

/**
 * Validate and sanitize a Solana public key / wallet address
 * Returns null if invalid
 */
export function sanitizeSolanaAddress(input: string | undefined | null): string | null {
  if (!input) return null;
  
  // Remove whitespace
  const trimmed = input.trim();
  
  // Basic format check (base58, 32-44 chars)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    return null;
  }
  
  // Validate with Solana SDK
  try {
    const pubkey = new PublicKey(trimmed);
    return pubkey.toBase58();
  } catch {
    return null;
  }
}

/**
 * Validate a Solana address and throw if invalid
 */
export function requireValidSolanaAddress(
  input: string | undefined | null,
  fieldName: string = 'address'
): string {
  const sanitized = sanitizeSolanaAddress(input);
  if (!sanitized) {
    throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
  }
  return sanitized;
}

// ============================================
// URL VALIDATION
// ============================================

const ALLOWED_URL_PROTOCOLS = ['https:', 'http:'];
const BLOCKED_URL_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:'];

/**
 * Validate and sanitize a URL
 * Blocks dangerous protocols and validates format
 */
export function sanitizeUrl(
  input: string | undefined | null,
  options: {
    allowHttp?: boolean;
    allowedDomains?: string[];
    maxLength?: number;
  } = {}
): string | null {
  if (!input) return null;
  
  const { allowHttp = true, allowedDomains, maxLength = 2000 } = options;
  
  const trimmed = input.trim();
  
  // Check length
  if (trimmed.length > maxLength) {
    return null;
  }
  
  // Check for blocked protocols
  const lowerUrl = trimmed.toLowerCase();
  for (const protocol of BLOCKED_URL_PROTOCOLS) {
    if (lowerUrl.startsWith(protocol)) {
      return null;
    }
  }
  
  // Parse and validate URL
  try {
    const url = new URL(trimmed);
    
    // Check protocol
    const allowedProtocols = allowHttp 
      ? ALLOWED_URL_PROTOCOLS 
      : ['https:'];
    
    if (!allowedProtocols.includes(url.protocol)) {
      return null;
    }
    
    // Check domain whitelist if specified
    if (allowedDomains && allowedDomains.length > 0) {
      const hostname = url.hostname.toLowerCase();
      const isAllowed = allowedDomains.some(domain => {
        const d = domain.toLowerCase();
        return hostname === d || hostname.endsWith('.' + d);
      });
      if (!isAllowed) {
        return null;
      }
    }
    
    // Return normalized URL
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Validate URL and throw if invalid
 */
export function requireValidUrl(
  input: string | undefined | null,
  fieldName: string = 'URL',
  options: Parameters<typeof sanitizeUrl>[1] = {}
): string {
  const sanitized = sanitizeUrl(input, options);
  if (!sanitized) {
    throw new Error(`Invalid ${fieldName}: must be a valid HTTPS URL`);
  }
  return sanitized;
}

// ============================================
// NUMERIC VALIDATION
// ============================================

/**
 * Sanitize and validate a numeric string (for token amounts, etc.)
 * Returns null if invalid
 */
export function sanitizeNumericString(
  input: string | undefined | null,
  options: {
    allowNegative?: boolean;
    allowDecimals?: boolean;
    maxDecimals?: number;
    minValue?: string;
    maxValue?: string;
  } = {}
): string | null {
  if (!input) return null;
  
  const {
    allowNegative = false,
    allowDecimals = true,
    maxDecimals = 18,
    minValue,
    maxValue,
  } = options;
  
  const trimmed = input.trim();
  
  // Check format
  const pattern = allowNegative
    ? (allowDecimals ? /^-?\d+(\.\d+)?$/ : /^-?\d+$/)
    : (allowDecimals ? /^\d+(\.\d+)?$/ : /^\d+$/);
  
  if (!pattern.test(trimmed)) {
    return null;
  }
  
  // Check decimals
  if (allowDecimals && maxDecimals !== undefined) {
    const parts = trimmed.split('.');
    if (parts[1] && parts[1].length > maxDecimals) {
      return null;
    }
  }
  
  // Check range
  try {
    const value = BigInt(trimmed.replace('.', '').replace('-', ''));
    
    if (minValue !== undefined) {
      const min = BigInt(minValue.replace('.', '').replace('-', ''));
      if (value < min) return null;
    }
    
    if (maxValue !== undefined) {
      const max = BigInt(maxValue.replace('.', '').replace('-', ''));
      if (value > max) return null;
    }
  } catch {
    // For very large numbers or decimals, just accept if format is valid
  }
  
  return trimmed;
}

/**
 * Sanitize and validate an integer
 */
export function sanitizeInteger(
  input: string | number | undefined | null,
  options: {
    min?: number;
    max?: number;
    allowNegative?: boolean;
  } = {}
): number | null {
  if (input === undefined || input === null) return null;
  
  const { min, max, allowNegative = false } = options;
  
  const num = typeof input === 'string' ? parseInt(input, 10) : Math.floor(input);
  
  if (isNaN(num) || !isFinite(num)) {
    return null;
  }
  
  if (!allowNegative && num < 0) {
    return null;
  }
  
  if (min !== undefined && num < min) {
    return null;
  }
  
  if (max !== undefined && num > max) {
    return null;
  }
  
  return num;
}

// ============================================
// ARRAY VALIDATION
// ============================================

/**
 * Sanitize an array of strings (e.g., tags)
 */
export function sanitizeStringArray(
  input: string[] | undefined | null,
  options: {
    maxItems?: number;
    maxItemLength?: number;
    allowEmpty?: boolean;
    lowercase?: boolean;
    unique?: boolean;
  } = {}
): string[] {
  if (!input || !Array.isArray(input)) return [];
  
  const {
    maxItems = 20,
    maxItemLength = 50,
    allowEmpty = false,
    lowercase = false,
    unique = true,
  } = options;
  
  let result = input
    .slice(0, maxItems)
    .map(item => {
      if (typeof item !== 'string') return '';
      let sanitized = sanitizeString(item, { maxLength: maxItemLength });
      if (lowercase) sanitized = sanitized.toLowerCase();
      return sanitized;
    })
    .filter(item => allowEmpty || item.length > 0);
  
  if (unique) {
    result = [...new Set(result)];
  }
  
  return result;
}

// ============================================
// TOKEN METADATA VALIDATION
// ============================================

/**
 * Sanitize token symbol (uppercase, alphanumeric)
 */
export function sanitizeTokenSymbol(input: string | undefined | null): string | null {
  if (!input) return null;
  
  // Allow only alphanumeric, max 10 chars
  const sanitized = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 10);
  
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Sanitize token name
 */
export function sanitizeTokenName(input: string | undefined | null): string | null {
  if (!input) return null;
  
  const sanitized = sanitizeString(input, {
    maxLength: 100,
    allowNewlines: false,
    allowHtml: false,
  });
  
  return sanitized.length > 0 ? sanitized : null;
}

// ============================================
// LOG INJECTION PREVENTION
// ============================================

/**
 * Sanitize input for safe logging
 * Prevents log injection attacks
 */
export function sanitizeForLogging(input: any): string {
  if (input === null) return 'null';
  if (input === undefined) return 'undefined';
  
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  
  // Remove or encode characters that could forge log entries
  return str
    // Remove newlines (prevent fake log entries)
    .replace(/[\r\n]/g, '\\n')
    // Remove ANSI escape codes
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Limit length
    .substring(0, 1000);
}

// ============================================
// SEARCH QUERY SANITIZATION
// ============================================

/**
 * Sanitize search query to prevent ReDoS and SQL injection
 */
export function sanitizeSearchQuery(
  input: string | undefined | null,
  options: {
    maxLength?: number;
    allowWildcards?: boolean;
  } = {}
): string {
  if (!input) return '';
  
  const { maxLength = 100, allowWildcards = false } = options;
  
  let sanitized = input
    .trim()
    // Remove null bytes
    .replace(/\0/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove SQL quotes and comments
    .replace(/['"]/g, '')
    .replace(/--/g, '');
  
  if (!allowWildcards) {
    // Escape SQL wildcards
    sanitized = sanitized
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  }
  
  // Remove characters that could cause ReDoS
  // (repeated special chars that regex engines struggle with)
  sanitized = sanitized.replace(/([*+?{}()[\]\\|^$.]){2,}/g, '$1');
  
  // Limit length
  return sanitized.substring(0, maxLength);
}

// ============================================
// SIGNATURE VALIDATION
// ============================================

/**
 * Validate a base58-encoded signature
 */
export function sanitizeSignature(input: string | undefined | null): string | null {
  if (!input) return null;
  
  const trimmed = input.trim();
  
  // Base58 signature should be 87-88 characters
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(trimmed)) {
    return null;
  }
  
  return trimmed;
}

// ============================================
// VALIDATION RESULT TYPE
// ============================================

export interface ValidationResult<T> {
  success: boolean;
  value?: T;
  errors: string[];
}

/**
 * Create a validation result
 */
export function validationSuccess<T>(value: T): ValidationResult<T> {
  return { success: true, value, errors: [] };
}

export function validationFailure<T>(errors: string | string[]): ValidationResult<T> {
  return { 
    success: false, 
    errors: Array.isArray(errors) ? errors : [errors],
  };
}