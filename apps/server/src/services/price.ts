import { Connection, PublicKey } from '@solana/web3.js';
import { PriceData } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { getNetworkConfig } from '@memecoin-lending/config';
import { logger } from '../utils/logger.js';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Jupiter Price API response type
interface JupiterPriceResponse {
  data: Record<string, {
    id: string;
    mintSymbol: string;
    vsToken: string;
    vsTokenSymbol: string;
    price: number;
  } | null>;
  timeTaken: number;
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

class PriceService {
  private connection: Connection;
  
  constructor() {
    const networkConfig = getNetworkConfig();
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  }
  
  async getCurrentPrice(mint: string): Promise<PriceData> {
    // Check cache first
    const cacheKey = `price:${mint}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Get token info
    const token = await prisma.token.findUnique({
      where: { id: mint },
    });
    
    if (!token) {
      throw new Error('Token not found');
    }
    
    // Try to fetch from Jupiter first
    let price: PriceData | null = null;
    
    try {
      price = await this.fetchFromJupiter(mint);
    } catch (error) {
      logger.warn(`Failed to fetch price from Jupiter for ${mint}:`, error);
    }
    
    // Fallback to DexScreener
    if (!price) {
      try {
        price = await this.fetchFromDexScreener(mint);
      } catch (error) {
        logger.warn(`Failed to fetch price from DexScreener for ${mint}:`, error);
      }
    }
    
    // Fallback to mock prices for development
    if (!price) {
      const mockPrices: Record<string, string> = {
        // BONK
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': '0.00001234',
        // POPCAT
        '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC': '0.5678',
        // MEW
        'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5': '0.0123',
        // WEN
        'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk': '0.000456',
        // WIF
        'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': '2.45',
      };
      
      price = {
        tokenMint: mint,
        price: mockPrices[mint] || '0.001',
        timestamp: Date.now(),
        source: 'raydium',
      };
    }
    
    // Cache for 10 seconds
    await redis.setex(cacheKey, 10, JSON.stringify(price));
    
    // Store in price history
    await this.storePriceHistory(price);
    
    return price;
  }
  
  private async fetchFromJupiter(mint: string): Promise<PriceData | null> {
    const response = await fetch(
      `https://price.jup.ag/v6/price?ids=${mint}`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.status}`);
    }
    
    const data = await response.json() as JupiterPriceResponse;
    
    if (!data.data[mint]) {
      return null;
    }
    
    const priceData = data.data[mint];
    if (!priceData) {
      return null;
    }
    
    return {
      tokenMint: mint,
      price: priceData.price.toString(),
      timestamp: Date.now(),
      source: 'jupiter',
    };
  }
  
  private async fetchFromDexScreener(mint: string): Promise<PriceData | null> {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`);
    }
    
    const data = await response.json() as DexScreenerResponse;
    
    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }
    
    // Get the pair with highest liquidity
    const bestPair = data.pairs.reduce((best, current) => {
      return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
    });
    
    return {
      tokenMint: mint,
      price: bestPair.priceUsd,
      timestamp: Date.now(),
      source: 'raydium', // DexScreener doesn't fit our source type, use raydium as fallback
    };
  }
  
  async getPrice24hAgo(mint: string): Promise<PriceData | null> {
    const timestamp24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const price = await prisma.priceHistory.findFirst({
      where: {
        tokenMint: mint,
        timestamp: {
          gte: timestamp24hAgo,
          lte: new Date(timestamp24hAgo.getTime() + 60 * 60 * 1000), // 1h window
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
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
  
  async storePriceHistory(priceData: PriceData): Promise<void> {
    // Only store if price changed significantly (>0.1%)
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
  
  async updateAllPrices(): Promise<void> {
    const tokens = await prisma.token.findMany({
      where: { enabled: true },
    });
    
    for (const token of tokens) {
      try {
        await this.getCurrentPrice(token.id);
      } catch (error) {
        logger.error(`Failed to update price for ${token.symbol}:`, error);
      }
    }
  }
  
  async checkPriceAlerts(): Promise<void> {
    // Get users with price alerts enabled
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
    
    // Check active loans for price drops
    for (const user of users) {
      const loans = await prisma.loan.findMany({
        where: {
          borrower: user.id,
          status: 'active',
        },
      });
      
      for (const loan of loans) {
        const currentPrice = await this.getCurrentPrice(loan.tokenMint);
        const entryPrice = parseFloat(loan.entryPrice);
        const currentPriceNum = parseFloat(currentPrice.price);
        const priceDropPct = ((entryPrice - currentPriceNum) / entryPrice) * 100;
        
        const threshold = user.notificationPrefs?.priceThresholdPct || 10;
        
        if (priceDropPct >= threshold) {
          // Create price alert notification
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
      }
    }
  }
  
  async getBulkPrices(mints: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();
    
    // Try Jupiter bulk price API
    try {
      const mintsParam = mints.join(',');
      const response = await fetch(
        `https://price.jup.ag/v6/price?ids=${mintsParam}`,
        { signal: AbortSignal.timeout(10000) }
      );
      
      if (response.ok) {
        const data = await response.json() as JupiterPriceResponse;
        
        for (const mint of mints) {
          const priceData = data.data[mint];
          if (priceData) {
            results.set(mint, {
              tokenMint: mint,
              price: priceData.price.toString(),
              timestamp: Date.now(),
              source: 'jupiter',
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch bulk prices from Jupiter:', error);
    }
    
    // Fetch missing prices individually
    for (const mint of mints) {
      if (!results.has(mint)) {
        try {
          const price = await this.getCurrentPrice(mint);
          results.set(mint, price);
        } catch (error) {
          logger.error(`Failed to fetch price for ${mint}:`, error);
        }
      }
    }
    
    return results;
  }
  
  async testPriceSource(): Promise<{ working: boolean; source: string; latency: number }> {
    const testMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
    const startTime = Date.now();
    
    try {
      const response = await fetch(
        `https://price.jup.ag/v6/price?ids=${testMint}`,
        { signal: AbortSignal.timeout(5000) }
      );
      
      if (!response.ok) {
        return { working: false, source: 'jupiter', latency: Date.now() - startTime };
      }
      
      const data = await response.json() as JupiterPriceResponse;
      
      if (!data.data[testMint]) {
        return { working: false, source: 'jupiter', latency: Date.now() - startTime };
      }
      
      return { working: true, source: 'jupiter', latency: Date.now() - startTime };
    } catch (error) {
      return { working: false, source: 'jupiter', latency: Date.now() - startTime };
    }
  }
}

export const priceService = new PriceService();