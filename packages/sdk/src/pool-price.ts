/**
 * Pool Price Utilities
 * 
 * Reads prices directly from on-chain pools, mirroring the exact 
 * calculation done in the Solana program (utils.rs).
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// ============================================================
// CONSTANTS - Must match programs/memecoin-lending/src/utils.rs
// ============================================================

/** Price scale factor (1e9) - same as on-chain PRICE_SCALE */
export const PRICE_SCALE = new BN(1_000_000_000);

/** Decimal adjustment for PumpSwap (SOL has 9 decimals, tokens have 6) */
export const DECIMAL_ADJUSTMENT = new BN(1000);

/** The divisor to convert scaled price to human-readable SOL */
export const PRICE_TO_SOL_DIVISOR = 1_000_000; // 1e6

/** PumpSwap pool data offsets */
const PUMPSWAP_POOL_BASE_VAULT_OFFSET = 64;
const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET = 96;

/** Token account amount offset */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

// ============================================================
// TYPES
// ============================================================

export enum PoolType {
  Raydium = 'Raydium',
  Orca = 'Orca',
  Pumpfun = 'Pumpfun',
  PumpSwap = 'PumpSwap',
}

export interface PoolPriceResult {
  /** Price in the same scaled format as stored on-chain */
  priceScaled: BN;
  /** Human-readable price in SOL per token */
  priceInSol: number;
  /** Base vault balance (token amount) */
  baseVaultBalance: BN;
  /** Quote vault balance (SOL/WSOL amount) */
  quoteVaultBalance: BN;
  /** Pool type used */
  poolType: PoolType;
  /** Source of the price */
  source: 'pool' | 'jupiter-fallback';
}

export interface PumpSwapVaults {
  baseVault: PublicKey;
  quoteVault: PublicKey;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Extract vault addresses from PumpSwap pool data
 */
export function extractPumpSwapVaults(poolData: Buffer): PumpSwapVaults {
  if (poolData.length < PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32) {
    throw new Error(`Pool data too short: ${poolData.length} bytes`);
  }

  const baseVault = new PublicKey(
    poolData.slice(PUMPSWAP_POOL_BASE_VAULT_OFFSET, PUMPSWAP_POOL_BASE_VAULT_OFFSET + 32)
  );
  const quoteVault = new PublicKey(
    poolData.slice(PUMPSWAP_POOL_QUOTE_VAULT_OFFSET, PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32)
  );

  return { baseVault, quoteVault };
}

/**
 * Read token amount from a token account's raw data
 */
export function readTokenAccountAmount(accountData: Buffer): BN {
  if (accountData.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) {
    throw new Error(`Token account data too short: ${accountData.length} bytes`);
  }

  const amountBytes = accountData.slice(TOKEN_ACCOUNT_AMOUNT_OFFSET, TOKEN_ACCOUNT_AMOUNT_OFFSET + 8);
  return new BN(amountBytes, 'le');
}

/**
 * Calculate PumpSwap price using the same formula as on-chain
 * 
 * Formula: (quote_amount * PRICE_SCALE) / base_amount / 1000
 */
export function calculatePumpSwapPrice(
  baseVaultAmount: BN,
  quoteVaultAmount: BN
): BN {
  if (baseVaultAmount.isZero()) {
    throw new Error('Base vault amount is zero');
  }
  if (quoteVaultAmount.isZero()) {
    throw new Error('Quote vault amount is zero');
  }

  return quoteVaultAmount
    .mul(PRICE_SCALE)
    .div(baseVaultAmount)
    .div(DECIMAL_ADJUSTMENT);
}

/**
 * Convert Jupiter price (SOL per token) to scaled format matching on-chain
 * 
 * Jupiter returns: 0.000773 (human-readable SOL per token)
 * On-chain stores: 773 (scaled by 1e6)
 * 
 * Conversion: jupiterPrice * 1e6
 */
export function convertJupiterPriceToScaled(jupiterSolPrice: number): BN {
  // Multiply by 1e6 to match on-chain format
  // Use Math.round to handle floating point precision
  const scaled = Math.round(jupiterSolPrice * PRICE_TO_SOL_DIVISOR);
  return new BN(scaled);
}

/**
 * Convert scaled price to human-readable SOL
 */
export function convertScaledPriceToSol(scaledPrice: BN): number {
  return scaledPrice.toNumber() / PRICE_TO_SOL_DIVISOR;
}

// ============================================================
// MAIN FUNCTIONS
// ============================================================

/**
 * Get price directly from pool, matching on-chain calculation exactly
 */
export async function getPriceFromPool(
  connection: Connection,
  poolAddress: PublicKey,
  poolType: PoolType | string
): Promise<PoolPriceResult> {
  const normalizedPoolType = typeof poolType === 'string' 
    ? poolType as PoolType 
    : poolType;

  if (normalizedPoolType !== PoolType.PumpSwap) {
    throw new Error(`Pool type ${normalizedPoolType} not implemented. Use PumpSwap or Jupiter fallback.`);
  }

  // 1. Fetch pool account
  const poolAccount = await connection.getAccountInfo(poolAddress);
  if (!poolAccount) {
    throw new Error(`Pool account not found: ${poolAddress.toString()}`);
  }

  // 2. Extract vault addresses
  const { baseVault, quoteVault } = extractPumpSwapVaults(poolAccount.data);

  // 3. Fetch vault accounts
  const [baseVaultAccount, quoteVaultAccount] = await Promise.all([
    connection.getAccountInfo(baseVault),
    connection.getAccountInfo(quoteVault),
  ]);

  if (!baseVaultAccount) {
    throw new Error(`Base vault not found: ${baseVault.toString()}`);
  }
  if (!quoteVaultAccount) {
    throw new Error(`Quote vault not found: ${quoteVault.toString()}`);
  }

  // 4. Read vault balances
  const baseVaultBalance = readTokenAccountAmount(baseVaultAccount.data);
  const quoteVaultBalance = readTokenAccountAmount(quoteVaultAccount.data);

  // 5. Calculate price
  const priceScaled = calculatePumpSwapPrice(baseVaultBalance, quoteVaultBalance);
  const priceInSol = convertScaledPriceToSol(priceScaled);

  return {
    priceScaled,
    priceInSol,
    baseVaultBalance,
    quoteVaultBalance,
    poolType: PoolType.PumpSwap,
    source: 'pool',
  };
}

/**
 * Get price with Jupiter fallback
 * 
 * 1. Try to read from pool directly (matches on-chain exactly)
 * 2. If that fails, use Jupiter API with correct conversion
 */
export async function getPriceWithFallback(
  connection: Connection,
  tokenMint: PublicKey,
  poolAddress: PublicKey | null,
  poolType: PoolType | string | null,
  jupiterApiEndpoint: string = 'https://price.jup.ag/v6/price'
): Promise<PoolPriceResult> {
  
  // Try pool price first (if we have pool info)
  if (poolAddress && poolType) {
    try {
      const poolPrice = await getPriceFromPool(connection, poolAddress, poolType);
      return poolPrice;
    } catch (error: any) {
      console.warn(`[PoolPrice] Failed to get pool price, falling back to Jupiter: ${error.message}`);
    }
  }

  // Fallback to Jupiter
  try {
    const response = await fetch(
      `${jupiterApiEndpoint}?ids=${tokenMint.toString()}&vsToken=So11111111111111111111111111111111111111112`
    );
    
    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.status}`);
    }

    const data: any = await response.json();
    const priceData = data.data?.[tokenMint.toString()];
    
    if (!priceData?.price) {
      throw new Error('No price data from Jupiter');
    }

    // Jupiter returns price in SOL (or vs token specified)
    const jupiterSolPrice = priceData.price;
    
    // Convert to scaled format matching on-chain
    const priceScaled = convertJupiterPriceToScaled(jupiterSolPrice);

    return {
      priceScaled,
      priceInSol: jupiterSolPrice,
      baseVaultBalance: new BN(0), // Not available from Jupiter
      quoteVaultBalance: new BN(0),
      poolType: poolType as PoolType || PoolType.PumpSwap,
      source: 'jupiter-fallback',
    };

  } catch (error: any) {
    throw new Error(`Failed to get price from both pool and Jupiter: ${error.message}`);
  }
}

/**
 * Check if price indicates liquidation (current <= liquidation threshold)
 */
export function isLiquidatableByPrice(
  currentPriceScaled: BN,
  liquidationPriceScaled: BN | string
): boolean {
  const liqPrice = typeof liquidationPriceScaled === 'string' 
    ? new BN(liquidationPriceScaled) 
    : liquidationPriceScaled;
  
  return currentPriceScaled.lte(liqPrice);
}

/**
 * Get PumpSwap vaults from pool address
 */
export async function getPumpSwapVaults(
  connection: Connection,
  poolAddress: PublicKey
): Promise<PumpSwapVaults | null> {
  try {
    const poolAccount = await connection.getAccountInfo(poolAddress);
    if (!poolAccount) return null;
    return extractPumpSwapVaults(poolAccount.data);
  } catch {
    return null;
  }
}