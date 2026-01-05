import { PublicKey } from '@solana/web3.js';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupiterPriceResponse {
  data: {
    [mint: string]: {
      id: string;
      type: string;
      price: string;
      extraInfo?: {
        lastSwappedPrice?: {
          lastJupiterSellAt: number;
          lastJupiterSellPrice: string;
          lastJupiterBuyAt: number;
          lastJupiterBuyPrice: string;
        };
        quotedPrice?: {
          buyPrice: string;
          buyAt: number;
          sellPrice: string;
          sellAt: number;
        };
      };
    };
  };
  timeTaken: number;
}

/**
 * Fetch token price from Jupiter Price API v2
 * Returns price in SOL (not USD)
 */
export async function getJupiterPrice(tokenMint: string): Promise<{
  price: number;
  priceInLamports: bigint;
  timestamp: number;
}> {
  try {
    // Jupiter returns price in USD, we need to convert to SOL
    // Fetch both token price and SOL price
    const url = `${JUPITER_PRICE_API}?ids=${tokenMint},${NATIVE_SOL_MINT}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
    }

    const data: JupiterPriceResponse = await response.json();
    
    const tokenData = data.data[tokenMint];
    const solData = data.data[NATIVE_SOL_MINT];
    
    if (!tokenData) {
      throw new Error(`Token not found in Jupiter: ${tokenMint}`);
    }
    
    if (!solData) {
      throw new Error('SOL price not available from Jupiter');
    }

    const tokenPriceUsd = parseFloat(tokenData.price);
    const solPriceUsd = parseFloat(solData.price);
    
    if (tokenPriceUsd <= 0 || solPriceUsd <= 0) {
      throw new Error('Invalid price from Jupiter (zero or negative)');
    }

    // Calculate token price in SOL
    const priceInSol = tokenPriceUsd / solPriceUsd;
    
    // Convert to lamports per token (with 6 decimal precision for price)
    // Price scale used on-chain is 1_000_000 (10^6)
    const PRICE_SCALE = 1_000_000;
    const priceInLamports = BigInt(Math.floor(priceInSol * PRICE_SCALE));
    
    console.log(`[Jupiter] ${tokenMint.slice(0, 8)}... price: ${priceInSol.toExponential(4)} SOL (${priceInLamports} scaled)`);

    return {
      price: priceInSol,
      priceInLamports,
      timestamp: Math.floor(Date.now() / 1000),
    };
  } catch (error: any) {
    console.error('[Jupiter] Price fetch error:', error.message);
    throw new Error(`Failed to fetch Jupiter price: ${error.message}`);
  }
}

/**
 * Validate that Jupiter price is reasonable
 */
export function validateJupiterPrice(
  jupiterPrice: bigint,
  poolPrice: bigint,
  maxDeviationBps: number = 2000 // 20%
): { valid: boolean; deviationBps: number; reason?: string } {
  if (jupiterPrice <= 0n || poolPrice <= 0n) {
    return { valid: false, deviationBps: 10000, reason: 'Zero or negative price' };
  }

  // Calculate deviation in basis points
  let deviationBps: number;
  if (jupiterPrice > poolPrice) {
    deviationBps = Number((jupiterPrice - poolPrice) * 10000n / poolPrice);
  } else {
    deviationBps = Number((poolPrice - jupiterPrice) * 10000n / jupiterPrice);
  }

  if (deviationBps > maxDeviationBps) {
    return {
      valid: false,
      deviationBps,
      reason: `Price deviation ${deviationBps / 100}% exceeds maximum ${maxDeviationBps / 100}%`,
    };
  }

  return { valid: true, deviationBps };
}