import { Connection, PublicKey } from '@solana/web3.js';
import { PriceData } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { getNetworkConfig, NetworkType } from '@memecoin-lending/config';
import { logger } from '../utils/logger.js';
import Redis from 'ioredis';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { jupiterClient } from './jupiter-client.js';

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
    blockId: number | null;
    decimals: number;
    usdPrice: number;
    priceChange24h: number | null;
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
  dexScreenerAvailable: boolean;
  lastCheck: number;
  cacheSize: number;
  uptime: number;
}


class PriceService {
  private connection: Connection;
  private cache = new Map<string, { data: ExtendedPriceData; timestamp: number }>();
  private readonly CACHE_TTL = 3 * 1000; // 3 seconds (reduced for faster updates)
  private serviceStartTime = Date.now();
  private jupiterAvailable = true;
  private dexScreenerAvailable = true;
  private lastHealthCheck = 0;
  
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
   * Get prices for multiple tokens with proper fallback
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

    // Track which tokens failed from each source
    const failedSources: Map<string, string[]> = new Map();

    // 1. Try Jupiter first
    try {
      const jupiterPrices = await this.fetchFromJupiter(uncachedMints);
      for (const [mint, price] of jupiterPrices) {
        results.set(mint, price);
        this.cache.set(mint, { data: price, timestamp: Date.now() });
        
        // Also cache in Redis
        await redis.setex(`price:${mint}`, 10, JSON.stringify(price));
      }
      
      // Track tokens that Jupiter couldn't find
      const jupiterMissing = uncachedMints.filter(m => !jupiterPrices.has(m));
      if (jupiterMissing.length > 0) {
        failedSources.set('jupiter', jupiterMissing);
      }
      
      // Remove fetched mints from uncached list
      uncachedMints.splice(0, uncachedMints.length, ...jupiterMissing);
    } catch (error) {
      logger.warn('Failed to fetch from Jupiter:', { error: error instanceof Error ? error.message : String(error) });
      failedSources.set('jupiter', [...uncachedMints]);
      
      // SECURITY: Alert on Jupiter API failure
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.JUPITER_API_ERROR,
        message: `Jupiter API failed, falling back to DexScreener: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          tokenCount: uncachedMints.length,
          error: error instanceof Error ? error.message : String(error),
          jupiterAvailable: this.jupiterAvailable,
        },
        source: 'price-service',
      });
    }

    // 2. Try DexScreener for remaining
    const dexScreenerAttempted = [...uncachedMints];
    const dexScreenerFailed: string[] = [];
    
    for (const mint of dexScreenerAttempted) {
      try {
        const price = await this.fetchFromDexScreener(mint);
        if (price) {
          results.set(mint, price);
          this.cache.set(mint, { data: price, timestamp: Date.now() });
          await redis.setex(`price:${mint}`, 10, JSON.stringify(price));
          
          // Alert on DexScreener fallback
          if (failedSources.has('jupiter') && failedSources.get('jupiter')!.includes(mint)) {
            await securityMonitor.log({
              severity: 'MEDIUM',
              category: 'Price Monitoring',
              eventType: 'PRICE_SOURCE_FAILOVER',
              message: `Price source switched from Jupiter to DexScreener for ${mint}`,
              details: {
                tokenMint: mint,
                previousSource: 'jupiter',
                newSource: 'dexscreener',
                price: price.usdPrice,
              },
              source: 'price-service',
            });
          }
          
          const index = uncachedMints.indexOf(mint);
          if (index > -1) uncachedMints.splice(index, 1);
        } else {
          dexScreenerFailed.push(mint);
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${mint} from DexScreener:`, { error: error instanceof Error ? error.message : String(error) });
        dexScreenerFailed.push(mint);
      }
    }
    
    if (dexScreenerFailed.length > 0) {
      failedSources.set('dexscreener', dexScreenerFailed);
    }

    // Alert if any tokens have no price data from any source
    if (uncachedMints.length > 0) {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_STALE_DATA,
        message: `No price data available from any source for ${uncachedMints.length} tokens`,
        details: {
          tokens: uncachedMints.slice(0, 10), // Limit to first 10 to avoid huge logs
          totalFailed: uncachedMints.length,
          failedBySource: Object.fromEntries(failedSources),
          jupiterAvailable: this.jupiterAvailable,
          dexScreenerAvailable: this.dexScreenerAvailable,
        },
        source: 'price-service',
      });
    }

    // For any remaining mints without prices, we don't add fallback data
    // This ensures we only return real price data

    return results;
  }

  /**
   * Get current price (for backwards compatibility)
   */
  async getCurrentPrice(mint: string): Promise<PriceData> {
    const extPrice = await this.getPrice(mint);
    
    if (!extPrice) {
      // SECURITY: Log when price data is completely unavailable
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_STALE_DATA,
        message: 'No price data available for token',
        details: {
          tokenMint: mint,
          cacheSize: this.cache.size,
          jupiterAvailable: this.jupiterAvailable,
          dexScreenerAvailable: this.dexScreenerAvailable,
        },
        source: 'price-service',
      });
      throw new Error('Token not found');
    }
    
    // SECURITY: Check for stale price data
    const dataAge = Date.now() - extPrice.timestamp;
    if (dataAge > 60000) { // 1 minute old
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_STALE_DATA,
        message: `Returning stale price data (${Math.round(dataAge / 1000)}s old)`,
        details: {
          tokenMint: mint,
          dataAge: Math.round(dataAge / 1000),
          source: extPrice.source,
          price: extPrice.usdPrice,
        },
        source: 'price-service',
      });
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
      const prices = await jupiterClient.fetchPrices([solMint]);
      
      if (prices[solMint]) {
        const price = prices[solMint].price;
        
        const priceData: ExtendedPriceData = {
          mint: solMint,
          usdPrice: price,
          source: 'jupiter',
          timestamp: Date.now(),
        };
        
        this.cache.set(solMint, { data: priceData, timestamp: Date.now() });
        return price;
      }
    } catch (error) {
      logger.warn('Failed to fetch SOL price from Jupiter:', { error: error instanceof Error ? error.message : String(error) });
    }

    // Fallback
    return 150.0;
  }

  /**
   * Fetch prices from Jupiter API
   */
  private async fetchFromJupiter(mints: string[]): Promise<Map<string, ExtendedPriceData>> {
    const results = new Map<string, ExtendedPriceData>();
    
    const prices = await jupiterClient.fetchPrices(mints);
    
    for (const [mint, data] of Object.entries(prices)) {
      results.set(mint, {
        mint,
        usdPrice: data.price,
        source: 'jupiter',
        timestamp: Date.now(),
      });
    }
    
    this.jupiterAvailable = true;
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
    const healthStatus = jupiterClient.getHealthStatus();
    const firstEndpoint = healthStatus.endpoints[0];
    
    if (!firstEndpoint) {
      return { working: false, latency: 0, error: 'No endpoints configured' };
    }
    
    const result = await jupiterClient.testEndpoint(firstEndpoint.id);
    this.lastHealthCheck = Date.now();
    
    this.jupiterAvailable = result.success;
    
    return {
      working: result.success,
      latency: result.latencyMs ?? 0,
      error: result.error,
    };
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
          logger.error(`Failed to check price alert for loan ${loan.id}:`, { error: error instanceof Error ? error.message : String(error) });
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

  /**
   * Get extended price data including liquidity info
   */
  async getExtendedPriceData(mint: string): Promise<{ liquidity?: { usd: number } } & PriceData> {
    try {
      // Try DexScreener first as it includes liquidity data
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
        { signal: AbortSignal.timeout(5000) }
      );
      
      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }
      
      const data = await response.json() as DexScreenerResponse;
      
      if (!data.pairs || data.pairs.length === 0) {
        // Fallback to regular price data
        const priceData = await this.getCurrentPrice(mint);
        return priceData;
      }
      
      // Get the pair with highest liquidity
      const bestPair = data.pairs.reduce((best, current) => {
        return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
      });
      
      return {
        tokenMint: mint,
        price: bestPair.priceUsd,
        timestamp: Date.now(),
        source: 'dexscreener' as any,
        liquidity: bestPair.liquidity,
      };
    } catch (error: any) {
      console.error('[PriceService] Failed to get extended price data:', error);
      // Fallback to regular price without liquidity
      const priceData = await this.getCurrentPrice(mint);
      return priceData;
    }
  }
}

export const priceService = new PriceService();
export type { ExtendedPriceData };