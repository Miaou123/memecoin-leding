import { PublicKey, Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { API_ENDPOINTS } from '@memecoin-lending/config';

export interface PriceData {
  mint: string;
  usdPrice: number;
  solPrice?: number;
  decimals: number;
  priceChange24h?: number | null;
  source: 'jupiter' | 'dexscreener' | 'onchain';
  timestamp: number;
}

export interface PriceResponse {
  success: boolean;
  data: Record<string, PriceData | null>;
  timestamp: number;
  cached?: number;
}

export interface SinglePriceResponse {
  success: boolean;
  data: PriceData | null;
  timestamp: number;
}

interface SolPriceResponse {
  success: boolean;
  data?: { usdPrice: number };
}

export class PriceClient {
  private apiEndpoint: string;
  private cache = new Map<string, { data: PriceData; timestamp: number }>();
  private readonly CACHE_TTL = 10 * 1000; // 10 seconds

  constructor(apiEndpoint?: string) {
    this.apiEndpoint = apiEndpoint || API_ENDPOINTS.MAINNET;
  }

  /**
   * Fetch prices for multiple tokens from server API
   */
  async getPrices(mints: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();
    const uncachedMints: string[] = [];
    
    // Check cache first
    for (const mint of mints) {
      const cached = this.cache.get(mint);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        results.set(mint, cached.data);
      } else {
        uncachedMints.push(mint);
      }
    }

    if (uncachedMints.length === 0) {
      return results;
    }

    try {
      const mintsParam = uncachedMints.join(',');
      const url = `${this.apiEndpoint}/api/prices?mints=${encodeURIComponent(mintsParam)}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Price API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as PriceResponse;
      
      if (result.success && result.data) {
        for (const [mint, priceData] of Object.entries(result.data)) {
          if (priceData) {
            results.set(mint, priceData);
            this.cache.set(mint, { data: priceData, timestamp: Date.now() });
          }
        }
      }

    } catch (error) {
      console.error('Failed to fetch prices from API:', error);
    }

    return results;
  }

  /**
   * Fetch price for a single token
   */
  async getPrice(mint: string): Promise<PriceData | null> {
    const prices = await this.getPrices([mint]);
    return prices.get(mint) || null;
  }

  /**
   * Fetch price for a single token directly from server
   */
  async getSinglePrice(mint: string): Promise<PriceData | null> {
    // Check cache first
    const cached = this.cache.get(mint);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const url = `${this.apiEndpoint}/api/prices/${mint}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null; // Price not found
        }
        throw new Error(`Price API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as SinglePriceResponse;
      
      if (result.success && result.data) {
        this.cache.set(mint, { data: result.data, timestamp: Date.now() });
        return result.data;
      }

    } catch (error) {
      console.error(`Failed to fetch price for ${mint}:`, error);
    }

    return null;
  }

  /**
   * Get SOL price in USD
   */
  async getSolPrice(): Promise<number | null> {
    try {
      const url = `${this.apiEndpoint}/api/prices/sol/usd`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`SOL price API error: ${response.status}`);
      }

      const result = await response.json() as SolPriceResponse;
      
      if (result.success && result.data) {
        return result.data.usdPrice;
      }

    } catch (error) {
      console.error('Failed to fetch SOL price:', error);
    }

    return null;
  }

  /**
   * Get all whitelisted token prices
   */
  async getAllTokenPrices(): Promise<Map<string, PriceData>> {
    try {
      const url = `${this.apiEndpoint}/api/prices?tokens=all`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`All prices API error: ${response.status}`);
      }

      const result = await response.json() as PriceResponse;
      const prices = new Map<string, PriceData>();
      
      if (result.success && result.data) {
        for (const [mint, priceData] of Object.entries(result.data)) {
          if (priceData) {
            prices.set(mint, priceData);
            this.cache.set(mint, { data: priceData, timestamp: Date.now() });
          }
        }
      }

      return prices;

    } catch (error) {
      console.error('Failed to fetch all token prices:', error);
      return new Map();
    }
  }

  /**
   * Convert token amount to USD value
   */
  async getTokenValueUsd(mint: string, amount: BN, decimals?: number): Promise<number | null> {
    const price = await this.getPrice(mint);
    if (!price) {
      return null;
    }

    const tokenDecimals = decimals || price.decimals;
    const adjustedAmount = amount.toNumber() / Math.pow(10, tokenDecimals);
    return adjustedAmount * price.usdPrice;
  }

  /**
   * Convert token amount to SOL value
   */
  async getTokenValueSol(mint: string, amount: BN, decimals?: number): Promise<number | null> {
    const price = await this.getPrice(mint);
    if (!price?.solPrice) {
      return null;
    }

    const tokenDecimals = decimals || price.decimals;
    const adjustedAmount = amount.toNumber() / Math.pow(10, tokenDecimals);
    return adjustedAmount * price.solPrice;
  }

  /**
   * Convert USD amount to SOL amount
   */
  async convertUsdToSol(usdAmount: number): Promise<number | null> {
    const solPrice = await this.getSolPrice();
    if (!solPrice) {
      return null;
    }
    return usdAmount / solPrice;
  }

  /**
   * Convert SOL amount to USD amount
   */
  async convertSolToUsd(solAmount: number): Promise<number | null> {
    const solPrice = await this.getSolPrice();
    if (!solPrice) {
      return null;
    }
    return solAmount * solPrice;
  }

  /**
   * Calculate loan value in USD
   */
  async calculateLoanValueUsd(
    tokenMint: string,
    collateralAmount: BN,
    tokenDecimals?: number
  ): Promise<{
    collateralValueUsd: number;
    tokenPrice: PriceData;
  } | null> {
    const price = await this.getPrice(tokenMint);
    if (!price) {
      return null;
    }

    const decimals = tokenDecimals || price.decimals;
    const adjustedAmount = collateralAmount.toNumber() / Math.pow(10, decimals);
    const collateralValueUsd = adjustedAmount * price.usdPrice;

    return {
      collateralValueUsd,
      tokenPrice: price,
    };
  }

  /**
   * Check if loan is at liquidation risk based on current prices
   */
  async checkLiquidationRisk(
    tokenMint: string,
    collateralAmount: BN,
    solBorrowed: BN,
    liquidationThresholdBps: number,
    tokenDecimals?: number
  ): Promise<{
    isAtRisk: boolean;
    currentLtv: number;
    liquidationLtv: number;
    collateralValueUsd: number;
    loanValueUsd: number;
    priceData: PriceData;
  } | null> {
    const loanValue = await this.calculateLoanValueUsd(tokenMint, collateralAmount, tokenDecimals);
    const solPrice = await this.getSolPrice();
    
    if (!loanValue || !solPrice) {
      return null;
    }

    const loanValueUsd = (solBorrowed.toNumber() / 1e9) * solPrice; // Convert lamports to SOL, then USD
    const currentLtv = (loanValueUsd / loanValue.collateralValueUsd) * 10000; // in basis points
    const liquidationLtv = liquidationThresholdBps;
    
    return {
      isAtRisk: currentLtv >= liquidationLtv,
      currentLtv: currentLtv / 100, // Convert to percentage for display
      liquidationLtv: liquidationLtv / 100,
      collateralValueUsd: loanValue.collateralValueUsd,
      loanValueUsd,
      priceData: loanValue.tokenPrice,
    };
  }

  /**
   * Clear price cache
   */
  clearCache(mints?: string[]): void {
    if (mints) {
      for (const mint of mints) {
        this.cache.delete(mint);
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Set API endpoint
   */
  setApiEndpoint(endpoint: string): void {
    this.apiEndpoint = endpoint;
  }
}

export const priceClient = new PriceClient();
export default priceClient;