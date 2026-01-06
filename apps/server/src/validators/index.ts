/**
 * Request validation schemas with sanitization
 */

import { z } from 'zod';
import {
  sanitizeSolanaAddress,
  sanitizeString,
  sanitizeUrl,
  sanitizeTokenSymbol,
  sanitizeTokenName,
  sanitizeStringArray,
  sanitizeNumericString,
  sanitizeInteger,
  sanitizeSearchQuery,
} from '../utils/inputSanitizer.js';

// ============================================
// CUSTOM ZOD TYPES WITH SANITIZATION
// ============================================

/**
 * Solana address that auto-sanitizes and validates
 */
export const solanaAddressSchema = z.string()
  .min(32, 'Address too short')
  .max(44, 'Address too long')
  .transform((val) => {
    const sanitized = sanitizeSolanaAddress(val);
    if (!sanitized) {
      throw new Error('Invalid Solana address');
    }
    return sanitized;
  });

/**
 * Optional Solana address
 */
export const optionalSolanaAddressSchema = z.string()
  .optional()
  .transform((val) => val ? sanitizeSolanaAddress(val) : undefined);

/**
 * Safe string that strips HTML and limits length
 */
export const safeStringSchema = (maxLength: number = 1000) => 
  z.string()
    .transform((val) => sanitizeString(val, { maxLength }));

/**
 * HTTPS URL schema
 */
export const httpsUrlSchema = z.string()
  .optional()
  .transform((val) => {
    if (!val) return undefined;
    const sanitized = sanitizeUrl(val, { allowHttp: false });
    if (!sanitized) {
      throw new Error('Must be a valid HTTPS URL');
    }
    return sanitized;
  });

/**
 * Token symbol schema
 */
export const tokenSymbolSchema = z.string()
  .optional()
  .transform((val) => val ? sanitizeTokenSymbol(val) : undefined);

/**
 * Token name schema  
 */
export const tokenNameSchema = z.string()
  .optional()
  .transform((val) => val ? sanitizeTokenName(val) : undefined);

/**
 * Tags array schema
 */
export const tagsSchema = z.array(z.string())
  .optional()
  .transform((val) => val ? sanitizeStringArray(val, {
    maxItems: 10,
    maxItemLength: 30,
    lowercase: true,
    unique: true,
  }) : []);

/**
 * Search query schema
 */
export const searchQuerySchema = z.string()
  .optional()
  .transform((val) => val ? sanitizeSearchQuery(val, { maxLength: 100 }) : undefined);

/**
 * Numeric string (for token amounts)
 */
export const numericStringSchema = z.string()
  .optional()
  .transform((val) => val ? sanitizeNumericString(val, {
    allowNegative: false,
    allowDecimals: true,
    maxDecimals: 18,
  }) : undefined);

/**
 * Positive integer schema
 */
export const positiveIntSchema = z.union([z.string(), z.number()])
  .transform((val) => {
    const sanitized = sanitizeInteger(val, { min: 1 });
    if (sanitized === null) {
      throw new Error('Must be a positive integer');
    }
    return sanitized;
  });

/**
 * Pagination schema
 */
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// ============================================
// WHITELIST ENTRY SCHEMAS
// ============================================

export const createWhitelistEntrySchema = z.object({
  mint: solanaAddressSchema,
  symbol: tokenSymbolSchema,
  name: tokenNameSchema,
  tier: z.enum(['bronze', 'silver', 'gold']),
  ltvBps: z.number().min(1000).max(9000).optional(),
  minLoanAmount: numericStringSchema,
  maxLoanAmount: numericStringSchema,
  reason: safeStringSchema(500).optional(),
  notes: safeStringSchema(1000).optional(),
  externalUrl: httpsUrlSchema,
  logoUrl: httpsUrlSchema,
  tags: tagsSchema,
});

export const updateWhitelistEntrySchema = z.object({
  symbol: tokenSymbolSchema,
  name: tokenNameSchema,
  tier: z.enum(['bronze', 'silver', 'gold']).optional(),
  ltvBps: z.number().min(1000).max(9000).optional(),
  minLoanAmount: numericStringSchema,
  maxLoanAmount: numericStringSchema,
  enabled: z.boolean().optional(),
  reason: safeStringSchema(500).optional(),
  notes: safeStringSchema(1000).optional(),
  externalUrl: httpsUrlSchema,
  logoUrl: httpsUrlSchema,
  tags: tagsSchema,
});

export const getWhitelistEntriesSchema = z.object({
  mint: optionalSolanaAddressSchema,
  tier: z.enum(['bronze', 'silver', 'gold']).optional(),
  enabled: z.string()
    .optional()
    .transform((val) => val === 'true' ? true : val === 'false' ? false : undefined),
  addedBy: optionalSolanaAddressSchema,
  tags: z.string()
    .optional()
    .transform((val) => val ? sanitizeStringArray(val.split(',')) : undefined),
  search: searchQuerySchema,
  sortBy: z.enum(['addedAt', 'updatedAt', 'symbol', 'tier']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

// ============================================
// LOAN SCHEMAS
// ============================================

export const createLoanSchema = z.object({
  tokenMint: solanaAddressSchema,
  collateralAmount: z.string().transform((val) => {
    const sanitized = sanitizeNumericString(val, {
      allowNegative: false,
      allowDecimals: true,
    });
    if (!sanitized) {
      throw new Error('Invalid collateral amount');
    }
    return sanitized;
  }),
  durationSeconds: z.number().min(3600).max(2592000), // 1 hour to 30 days
  borrower: solanaAddressSchema,
});

export const getLoansSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['active', 'repaid', 'liquidatedTime', 'liquidatedPrice']).optional(),
  tokenMint: optionalSolanaAddressSchema,
  borrower: optionalSolanaAddressSchema,
  sortBy: z.enum(['createdAt', 'dueAt', 'solBorrowed']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// TOKEN SCHEMAS
// ============================================

export const verifyTokenSchema = z.object({
  mint: solanaAddressSchema,
});

export const batchVerifyTokensSchema = z.object({
  mints: z.array(solanaAddressSchema)
    .min(1, 'At least one mint required')
    .max(10, 'Maximum 10 mints allowed'),
});

// ============================================
// AUTH SCHEMAS
// ============================================

export const authHeadersSchema = z.object({
  'x-signature': z.string().min(64).max(128),
  'x-public-key': solanaAddressSchema,
  'x-timestamp': z.string().regex(/^\d+$/).transform(Number),
});