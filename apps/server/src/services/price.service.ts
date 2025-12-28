import { Connection, PublicKey } from '@solana/web3.js';
import { PriceData } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { getNetworkConfig } from '@memecoin-lending/config';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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
    
    // Fetch price from pool
    // In real implementation, this would fetch from Raydium/Orca pools
    // For now, use mock prices
    const mockPrices: Record<string, string> = {
      // BONK
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': '0.00001234',
      // POPCAT
      '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC': '0.5678',
      // MEW
      'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5': '0.0123',
      // WEN
      'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk': '0.000456',
    };
    
    const price: PriceData = {
      tokenMint: mint,
      price: mockPrices[mint] || '0.001',
      timestamp: Date.now(),
      source: 'raydium',
    };
    
    // Cache for 10 seconds
    await redis.setex(cacheKey, 10, JSON.stringify(price));
    
    // Store in price history
    await this.storePriceHistory(price);
    
    return price;
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
      source: price.source as any,
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
        console.error(`Failed to update price for ${token.symbol}:`, error);
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
}

export const priceService = new PriceService();