/**
 * PumpSwap Pool Discovery Service
 * 
 * Provides on-chain pool discovery for PumpSwap pools with DexScreener fallback
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger.js';

// ============================================================
// CONSTANTS - Must match on-chain program
// ============================================================

export const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Pool account size and layout offsets
export const POOL_SIZE = 301;
export const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
export const POOL_BASE_MINT_OFFSET = 43;
export const POOL_QUOTE_MINT_OFFSET = 75;
export const POOL_BASE_VAULT_OFFSET = 139;
export const POOL_QUOTE_VAULT_OFFSET = 171;
export const POOL_MIN_LEN = 211; // Minimum required to read vaults

// ============================================================
// INTERFACES
// ============================================================

export interface PoolVaults {
  baseVault: PublicKey;
  quoteVault: PublicKey;
}

// ============================================================
// POOL DISCOVERY METHODS
// ============================================================

/**
 * Find PumpSwap pool using on-chain getProgramAccounts
 * This is the primary method that should be used
 */
export async function findPumpSwapPool(
  connection: Connection,
  tokenMint: PublicKey
): Promise<PublicKey | null> {
  try {
    logger.info('[PumpSwap] Finding pool on-chain', {
      tokenMint: tokenMint.toString(),
      method: 'getProgramAccounts'
    });

    // Search for pools with this token as base_mint
    const accounts = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
      filters: [
        { dataSize: POOL_SIZE },
        { memcmp: { offset: POOL_BASE_MINT_OFFSET, bytes: tokenMint.toBase58() } },
      ],
    });

    if (accounts.length === 0) {
      logger.info('[PumpSwap] No pools found on-chain', {
        tokenMint: tokenMint.toString()
      });
      return null;
    }

    if (accounts.length > 1) {
      logger.warn('[PumpSwap] Multiple pools found, using first one', {
        tokenMint: tokenMint.toString(),
        poolCount: accounts.length,
        pools: accounts.map(a => a.pubkey.toString())
      });
    }

    const poolAddress = accounts[0].pubkey;
    logger.info('[PumpSwap] Found pool on-chain', {
      tokenMint: tokenMint.toString(),
      poolAddress: poolAddress.toString()
    });

    return poolAddress;
  } catch (error) {
    logger.error('[PumpSwap] Error finding pool on-chain:', {
      tokenMint: tokenMint.toString(),
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Fallback: Find PumpSwap pool using DexScreener API
 * Only use this if on-chain method fails
 */
export async function findPumpSwapPoolFallback(tokenMint: string): Promise<string | null> {
  try {
    logger.info('[PumpSwap] Using DexScreener fallback', {
      tokenMint,
      method: 'dexscreener'
    });

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    if (data.pairs && data.pairs.length > 0) {
      for (const pair of data.pairs) {
        if (pair.dexId === 'pumpswap' && pair.quoteToken?.symbol === 'SOL') {
          logger.info('[PumpSwap] Found pool via DexScreener', {
            tokenMint,
            poolAddress: pair.pairAddress
          });
          return pair.pairAddress;
        }
      }
    }

    logger.info('[PumpSwap] No pool found via DexScreener', { tokenMint });
    return null;
  } catch (error) {
    logger.error('[PumpSwap] DexScreener fallback error:', {
      tokenMint,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Get PumpSwap pool address using on-chain method with fallback
 * This is the main function to use in production
 */
export async function getPumpSwapPoolAddress(
  connection: Connection,
  tokenMint: PublicKey
): Promise<PublicKey | null> {
  // Try on-chain method first
  const onChainPool = await findPumpSwapPool(connection, tokenMint);
  if (onChainPool) {
    return onChainPool;
  }

  // Fall back to DexScreener
  logger.warn('[PumpSwap] On-chain discovery failed, trying DexScreener', {
    tokenMint: tokenMint.toString()
  });

  const dexScreenerPool = await findPumpSwapPoolFallback(tokenMint.toString());
  if (dexScreenerPool) {
    try {
      return new PublicKey(dexScreenerPool);
    } catch (error) {
      logger.error('[PumpSwap] Invalid pool address from DexScreener:', {
        poolAddress: dexScreenerPool,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return null;
}

/**
 * Extract vault addresses from pool account data
 */
export function extractPoolVaults(poolData: Buffer): PoolVaults {
  if (poolData.length < POOL_MIN_LEN) {
    throw new Error(`Pool data too short: ${poolData.length} < ${POOL_MIN_LEN}`);
  }

  const baseVault = new PublicKey(poolData.slice(POOL_BASE_VAULT_OFFSET, POOL_BASE_VAULT_OFFSET + 32));
  const quoteVault = new PublicKey(poolData.slice(POOL_QUOTE_VAULT_OFFSET, POOL_QUOTE_VAULT_OFFSET + 32));

  return { baseVault, quoteVault };
}

/**
 * Verify a pool account is valid PumpSwap pool
 */
export function isValidPumpSwapPool(poolData: Buffer, expectedTokenMint?: PublicKey): boolean {
  if (poolData.length !== POOL_SIZE) {
    return false;
  }

  // Check discriminator
  const discriminator = Array.from(poolData.slice(0, 8));
  if (JSON.stringify(discriminator) !== JSON.stringify(POOL_DISCRIMINATOR)) {
    return false;
  }

  // Check base mint if provided
  if (expectedTokenMint) {
    const baseMint = new PublicKey(poolData.slice(POOL_BASE_MINT_OFFSET, POOL_BASE_MINT_OFFSET + 32));
    if (!baseMint.equals(expectedTokenMint)) {
      return false;
    }
  }

  // Check quote mint is WSOL
  const quoteMint = new PublicKey(poolData.slice(POOL_QUOTE_MINT_OFFSET, POOL_QUOTE_MINT_OFFSET + 32));
  if (!quoteMint.equals(WSOL_MINT)) {
    return false;
  }

  return true;
}

// Export a singleton service instance
export const pumpSwapPoolService = {
  findPumpSwapPool,
  findPumpSwapPoolFallback,
  getPumpSwapPoolAddress,
  extractPoolVaults,
  isValidPumpSwapPool,
};