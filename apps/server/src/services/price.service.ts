import { Connection, PublicKey } from '@solana/web3.js';
import { PriceData } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { getNetworkConfig, NetworkType } from '@memecoin-lending/config';
import { logger } from '../utils/logger.js';
import Redis from 'ioredis';
import { PumpFunSDK } from 'pumpdotfun-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Extended price data for internal use
interface ExtendedPriceData {
  mint: string;
  usdPrice: number;
  solPrice?: number;
  priceChange24h?: number;
  source: string;
  timestamp: number;
  decimals?: number;
}

// Jupiter Price API V3 response type
interface JupiterPriceResponse {
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
  } | null;
}

// DexScreener API response type
interface DexScreenerResponse {
  schemaVersion: string;
  pairs: Array<{
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
      address: string;
      name: string;
      symbol: string;
    };
    quoteToken: {
      address: string;
      name: string;
      symbol: string;
    };
    priceNative: string;
    priceUsd: string;
    txns: {
      h24: { buys: number; sells: number };
    };
    volume: { h24: number };
    priceChange: { h24: number };
    liquidity: { usd: number };
    fdv: number;
    pairCreatedAt: number;
  }>;
}

// Service status tracking
interface ServiceStatus {
  jupiterAvailable: boolean;
  pumpFunAvailable: boolean;
  dexScreenerAvailable: boolean;
  lastCheck: number;
  cacheSize: number;
  uptime: number;
}

class PriceService {
  private connection: Connection;
  private cache = new Map<string, { data: ExtendedPriceData; timestamp: number }>();
  private readonly CACHE_TTL = 10 * 1000; // 10 seconds
  private serviceStartTime = Date.now();
  private jupiterAvailable = true;
  private pumpFunAvailable = true;
  private dexScreenerAvailable = true;
  private lastHealthCheck = 0;
  private pumpFunSDK: PumpFunSDK | null = null;
  
  constructor() {
    const network = (process.env.SOLANA_NETWORK as NetworkType) || 'devnet';
    const networkConfig = getNetworkConfig(network);
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  }

  /**
   * Get price for a single token
   */
  async getPrice(mint: string): Promise<ExtendedPriceData | null> {
    const prices = await this.getPrices([mint]);
    return prices.get(mint) || null;
  }

  /**
   * Get prices for multiple tokens
   */
  async getPrices(mints: string[]): Promise<Map<string, ExtendedPriceData>> {
    const results = new Map<string, ExtendedPriceData>();
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

    // 1. Try Jupiter first
    try {
      const jupiterPrices = await this.fetchFromJupiter(uncachedMints);
      for (const [mint, price] of jupiterPrices) {
        results.set(mint, price);
        this.cache.set(mint, { data: price, timestamp: Date.now() });
        
        // Also cache in Redis
        await redis.setex(`price:${mint}`, 10, JSON.stringify(price));
      }
      
      // Remove fetched mints from uncached list
      uncachedMints.splice(0, uncachedMints.length, 
        ...uncachedMints.filter(m => !jupiterPrices.has(m)));
    } catch (error) {
      logger.warn('Failed to fetch from Jupiter:', error);
    }

    // 2. Try PumpFun for remaining (especially pump tokens)
    for (const mint of [...uncachedMints]) {
      // Try PumpFun for all remaining tokens (not just those ending in 'pump')
      // since some valid PumpFun tokens may not follow that pattern
      try {
        const price = await this.fetchFromPumpFun(mint);
        if (price) {
          results.set(mint, price);
          this.cache.set(mint, { data: price, timestamp: Date.now() });
          await redis.setex(`price:${mint}`, 10, JSON.stringify(price));
          // Remove from uncached list
          const index = uncachedMints.indexOf(mint);
          if (index > -1) uncachedMints.splice(index, 1);
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${mint} from PumpFun:`, error);
      }
    }

    // 3. Try DexScreener for remaining
    for (const mint of [...uncachedMints]) {
      try {
        const price = await this.fetchFromDexScreener(mint);
        if (price) {
          results.set(mint, price);
          this.cache.set(mint, { data: price, timestamp: Date.now() });
          await redis.setex(`price:${mint}`, 10, JSON.stringify(price));
          const index = uncachedMints.indexOf(mint);
          if (index > -1) uncachedMints.splice(index, 1);
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${mint} from DexScreener:`, error);
      }
    }

    // Fallback to mock prices for any remaining
    for (const mint of mints) {
      if (!results.has(mint)) {
        const mockPrice = this.getMockPrice(mint);
        results.set(mint, mockPrice);
        this.cache.set(mint, { data: mockPrice, timestamp: Date.now() });
      }
    }

    return results;
  }

  /**
   * Get current price (for backwards compatibility)
   */
  async getCurrentPrice(mint: string): Promise<PriceData> {
    const extPrice = await this.getPrice(mint);
    
    if (!extPrice) {
      throw new Error('Token not found');
    }
    
    // Convert to PriceData format
    return {
      tokenMint: extPrice.mint,
      price: extPrice.usdPrice.toString(),
      timestamp: extPrice.timestamp,
      source: extPrice.source as 'raydium' | 'orca' | 'jupiter',
    };
  }

  /**
   * Get or initialize PumpFun SDK
   */
  private async getPumpFunSDK(): Promise<PumpFunSDK> {
    if (!this.pumpFunSDK) {
      try {
        // Create a read-only provider (no wallet needed for price queries)
        const provider = new AnchorProvider(
          this.connection,
          {
            publicKey: PublicKey.default,
            signTransaction: async (tx) => tx,
            signAllTransactions: async (txs) => txs,
          },
          { commitment: 'confirmed' }
        );
        this.pumpFunSDK = new PumpFunSDK(provider);
      } catch (error) {
        logger.error('Failed to initialize PumpFun SDK:', error);
        this.pumpFunAvailable = false;
        throw error;
      }
    }
    return this.pumpFunSDK;
  }

  /**
   * Fetch price from PumpFun SDK
   */
  private async fetchFromPumpFun(mint: string): Promise<ExtendedPriceData | null> {
    try {
      const sdk = await this.getPumpFunSDK();
      const mintPubkey = new PublicKey(mint);
      
      // Get bonding curve data
      const bondingCurveAccount = await sdk.getBondingCurveAccount(mintPubkey);
      
      if (!bondingCurveAccount) {
        return null;
      }
      
      // Calculate price from bonding curve
      // Price in SOL = virtualSolReserves / virtualTokenReserves
      const virtualSolReserves = Number(bondingCurveAccount.virtualSolReserves);
      const virtualTokenReserves = Number(bondingCurveAccount.virtualTokenReserves);
      
      if (virtualTokenReserves === 0) {
        return null;
      }
      
      const priceInSol = virtualSolReserves / virtualTokenReserves;
      
      // Get SOL price in USD to calculate USD price
      const solUsdPrice = await this.getSolPrice();
      const priceInUsd = priceInSol * solUsdPrice;
      
      logger.info(`[PumpFun] ${mint}: ${priceInSol.toFixed(10)} SOL ($${priceInUsd.toFixed(6)})`);
      
      return {
        mint,
        usdPrice: priceInUsd,
        solPrice: priceInSol,
        source: 'pumpfun',
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.warn(`Failed to fetch ${mint} from PumpFun:`, error);
      this.pumpFunAvailable = false;
      return null;
    }
  }

  /**
   * Get SOL price in USD
   */
  async getSolPrice(): Promise<number> {
    const solMint = 'So11111111111111111111111111111111111111112';
    
    // Check cache
    const cached = this.cache.get(solMint);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data.usdPrice;
    }

    try {
      const response = await fetch(
        `https://api.jup.ag/price/v3?ids=${solMint}`,
        { 
          signal: AbortSignal.timeout(5000),
          headers: { 'x-api-key': process.env.JUPITER_API_KEY || '' }
        }
      );
      
      if (response.ok) {
        const data = await response.json() as JupiterPriceResponse;
        if (data[solMint]) {
          const price = parseFloat(data[solMint]!.price);
          
          const priceData: ExtendedPriceData = {
            mint: solMint,
            usdPrice: price,
            source: 'jupiter',
            timestamp: Date.now(),
          };
          
          this.cache.set(solMint, { data: priceData, timestamp: Date.now() });
          return price;
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch SOL price from Jupiter:', error);
    }

    // Fallback
    return 150.0;
  }

  /**
   * Fetch prices from Jupiter API
   */
  private async fetchFromJupiter(mints: string[]): Promise<Map<string, ExtendedPriceData>> {
    const results = new Map<string, ExtendedPriceData>();
    
    const response = await fetch(
      `https://api.jup.ag/price/v3?ids=${mints.join(',')}`,
      { 
        signal: AbortSignal.timeout(10000),
        headers: { 'x-api-key': process.env.JUPITER_API_KEY || '' }
      }
    );
    
    if (!response.ok) {
      this.jupiterAvailable = false;
      throw new Error(`Jupiter API error: ${response.status}`);
    }
    
    this.jupiterAvailable = true;
    const data = await response.json() as JupiterPriceResponse;
    
    for (const mint of mints) {
      const priceData = data[mint];
      if (priceData) {
        results.set(mint, {
          mint,
          usdPrice: parseFloat(priceData.price),
          source: 'jupiter',
          timestamp: Date.now(),
        });
      }
    }
    
    return results;
  }

  /**
   * Fetch price from DexScreener API
   */
  private async fetchFromDexScreener(mint: string): Promise<ExtendedPriceData | null> {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) {
      this.dexScreenerAvailable = false;
      throw new Error(`DexScreener API error: ${response.status}`);
    }
    
    this.dexScreenerAvailable = true;
    const data = await response.json() as DexScreenerResponse;
    
    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }
    
    // Get the pair with highest liquidity
    const bestPair = data.pairs.reduce((best, current) => {
      return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
    });
    
    return {
      mint,
      usdPrice: parseFloat(bestPair.priceUsd),
      solPrice: parseFloat(bestPair.priceNative),
      priceChange24h: bestPair.priceChange?.h24,
      source: 'dexscreener',
      timestamp: Date.now(),
    };
  }

  /**
   * Get mock price for development
   */
  private getMockPrice(mint: string): ExtendedPriceData {
    const mockPrices: Record<string, number> = {
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 0.00001234, // BONK
      '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC': 0.5678,     // POPCAT
      'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5': 0.0123,      // MEW
      'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk': 0.000456,    // WEN
      'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 2.45,       // WIF
      'So11111111111111111111111111111111111111112': 150.0,        // SOL
    };
    
    return {
      mint,
      usdPrice: mockPrices[mint] || 0.001,
      source: 'mock',
      timestamp: Date.now(),
    };
  }

  /**
   * Get price from 24h ago
   */
  async getPrice24hAgo(mint: string): Promise<PriceData | null> {
    const timestamp24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const price = await prisma.priceHistory.findFirst({
      where: {
        tokenMint: mint,
        timestamp: {
          gte: timestamp24hAgo,
          lte: new Date(timestamp24hAgo.getTime() + 60 * 60 * 1000),
        },
      },
      orderBy: { timestamp: 'desc' },
    });
    
    if (!price) {
      return null;
    }
    
    return {
      tokenMint: price.tokenMint,
      price: price.price,
      timestamp: price.timestamp.getTime(),
      source: price.source as 'raydium' | 'orca' | 'jupiter',
    };
  }

  /**
   * Store price in history
   */
  async storePriceHistory(priceData: PriceData): Promise<void> {
    const lastPrice = await prisma.priceHistory.findFirst({
      where: { tokenMint: priceData.tokenMint },
      orderBy: { timestamp: 'desc' },
    });
    
    if (lastPrice) {
      const priceDiff = Math.abs(
        (parseFloat(priceData.price) - parseFloat(lastPrice.price)) / 
        parseFloat(lastPrice.price)
      );
      
      if (priceDiff < 0.001) {
        return; // Price change too small
      }
    }
    
    await prisma.priceHistory.create({
      data: {
        tokenMint: priceData.tokenMint,
        price: priceData.price,
        source: priceData.source,
        timestamp: new Date(priceData.timestamp),
      },
    });
  }

  /**
   * Clear price cache
   */
  clearCache(mints?: string[]): void {
    if (mints) {
      for (const mint of mints) {
        this.cache.delete(mint);
        redis.del(`price:${mint}`).catch(() => {});
      }
    } else {
      this.cache.clear();
    }
    logger.info(`Cache cleared${mints ? ` for ${mints.length} mints` : ' entirely'}`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[]; hitRate?: number } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Get service status
   */
  getServiceStatus(): ServiceStatus {
    return {
      jupiterAvailable: this.jupiterAvailable,
      pumpFunAvailable: this.pumpFunAvailable,
      dexScreenerAvailable: this.dexScreenerAvailable,
      lastCheck: this.lastHealthCheck,
      cacheSize: this.cache.size,
      uptime: Date.now() - this.serviceStartTime,
    };
  }

  /**
   * Test Jupiter API connection
   */
  async testJupiterConnection(): Promise<{ working: boolean; latency: number; error?: string }> {
    const testMint = 'So11111111111111111111111111111111111111112'; // SOL
    const startTime = Date.now();
    
    try {
      const response = await fetch(
        `https://api.jup.ag/price/v3?ids=${testMint}`,
        { 
          signal: AbortSignal.timeout(5000),
          headers: { 'x-api-key': process.env.JUPITER_API_KEY || '' }
        }
      );
      
      const latency = Date.now() - startTime;
      this.lastHealthCheck = Date.now();
      
      if (!response.ok) {
        this.jupiterAvailable = false;
        return { working: false, latency, error: `HTTP ${response.status}` };
      }
      
      const data = await response.json() as JupiterPriceResponse;
      
      if (!data[testMint]) {
        this.jupiterAvailable = false;
        return { working: false, latency, error: 'No price data returned' };
      }
      
      this.jupiterAvailable = true;
      return { working: true, latency };
    } catch (error: any) {
      this.jupiterAvailable = false;
      return { 
        working: false, 
        latency: Date.now() - startTime, 
        error: error.message 
      };
    }
  }

  /**
   * Update all whitelisted token prices
   */
  async updateAllPrices(): Promise<void> {
    const tokens = await prisma.token.findMany({
      where: { enabled: true },
    });
    
    const mints = tokens.map((t: { id: string }) => t.id);
    
    if (mints.length > 0) {
      await this.getPrices(mints);
    }
    
    logger.info(`Updated prices for ${mints.length} tokens`);
  }

  /**
   * Check price alerts for all users
   */
  async checkPriceAlerts(): Promise<void> {
    const users = await prisma.user.findMany({
      where: {
        notificationPrefs: {
          priceAlerts: true,
        },
      },
      include: {
        notificationPrefs: true,
      },
    });
    
    for (const user of users) {
      const loans = await prisma.loan.findMany({
        where: {
          borrower: user.id,
          status: 'active',
        },
      });
      
      for (const loan of loans) {
        try {
          const currentPrice = await this.getCurrentPrice(loan.tokenMint);
          const entryPrice = parseFloat(loan.entryPrice);
          const currentPriceNum = parseFloat(currentPrice.price);
          const priceDropPct = ((entryPrice - currentPriceNum) / entryPrice) * 100;
          
          const threshold = user.notificationPrefs?.priceThresholdPct || 10;
          
          if (priceDropPct >= threshold) {
            await prisma.notification.create({
              data: {
                userId: user.id,
                loanId: loan.id,
                type: 'price_alert',
                title: 'Price Alert',
                message: `Token price dropped ${priceDropPct.toFixed(2)}% from your entry price`,
                data: {
                  entryPrice: loan.entryPrice,
                  currentPrice: currentPrice.price,
                  dropPercentage: priceDropPct,
                },
              },
            });
          }
        } catch (error) {
          logger.error(`Failed to check price alert for loan ${loan.id}:`, error);
        }
      }
    }
  }

  /**
   * Group price history by interval
   */
  groupPriceHistory(
    history: any[],
    interval: '1h' | '4h' | '1d'
  ): PriceData[] {
    const intervalMs = {
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    }[interval];
    
    const grouped: Record<number, PriceData> = {};
    
    for (const entry of history) {
      const timestamp = Math.floor(entry.timestamp.getTime() / intervalMs) * intervalMs;
      
      if (!grouped[timestamp] || entry.timestamp > grouped[timestamp].timestamp) {
        grouped[timestamp] = {
          tokenMint: entry.tokenMint,
          price: entry.price,
          timestamp: entry.timestamp.getTime(),
          source: entry.source,
        };
      }
    }
    
    return Object.values(grouped).sort((a, b) => a.timestamp - b.timestamp);
  }
}

export const priceService = new PriceService();
export type { ExtendedPriceData };