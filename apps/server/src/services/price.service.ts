import { Connection, PublicKey } from '@solana/web3.js';
import { PriceData } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { getNetworkConfig, NetworkType } from '@memecoin-lending/config';
import { logger } from '../utils/logger.js';
import Redis from 'ioredis';
import { PumpFunSDK } from 'pumpdotfun-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import { WebSocket } from 'ws';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

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
  pumpFunAvailable: boolean;
  dexScreenerAvailable: boolean;
  jupiterWebSocketConnected: boolean;
  lastCheck: number;
  cacheSize: number;
  uptime: number;
}

// Jupiter WebSocket price update interface
interface JupiterWSPriceUpdate {
  id: string;
  price: string;
  timestamp: number;
}

class PriceService {
  private connection: Connection;
  private cache = new Map<string, { data: ExtendedPriceData; timestamp: number }>();
  private readonly CACHE_TTL = 3 * 1000; // 3 seconds (reduced for faster updates)
  private serviceStartTime = Date.now();
  private jupiterAvailable = true;
  private pumpFunAvailable = true;
  private dexScreenerAvailable = true;
  private lastHealthCheck = 0;
  private pumpFunSDK: PumpFunSDK | null = null;
  
  // SECURITY: Jupiter WebSocket for real-time price streaming
  private jupiterWS: WebSocket | null = null;
  private wsReconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private trackedMints = new Set<string>();
  private wsConnected = false;
  
  constructor() {
    const network = (process.env.SOLANA_NETWORK as NetworkType) || 'devnet';
    const networkConfig = getNetworkConfig(network);
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');
    
    // SECURITY: Initialize Jupiter WebSocket for real-time price streaming
    this.initializeJupiterWebSocket();
  }

  /**
   * SECURITY: Initialize Jupiter WebSocket connection for real-time price streaming
   */
  private initializeJupiterWebSocket(): void {
    try {
      // Jupiter WebSocket URL (check Jupiter docs for the correct URL)
      const wsUrl = 'wss://price.jup.ag/v4/price-stream';
      
      this.jupiterWS = new WebSocket(wsUrl, {
        headers: {
          'x-api-key': process.env.JUPITER_API_KEY || '',
        },
      });

      this.jupiterWS.on('open', () => {
        logger.info('🔌 Jupiter WebSocket connected');
        this.wsConnected = true;
        this.wsReconnectAttempts = 0;
        
        // SECURITY: Log successful WebSocket connection
        securityMonitor.log({
          severity: 'LOW',
          category: 'Price Monitoring',
          eventType: SECURITY_EVENT_TYPES.PRICE_WEBSOCKET_CONNECTED,
          message: 'Jupiter WebSocket connection established',
          details: {
            wsUrl: 'wss://price.jup.ag/v4/price-stream',
            reconnectAttempt: this.wsReconnectAttempts,
          },
          source: 'price-service',
        });
        
        // Subscribe to tracked tokens
        this.subscribeToTrackedTokens();
      });

      this.jupiterWS.on('message', (data: string) => {
        try {
          const update = JSON.parse(data) as JupiterWSPriceUpdate;
          this.handlePriceUpdate(update);
        } catch (error) {
          logger.warn('Failed to parse WebSocket message:', { error: error instanceof Error ? error.message : String(error) });
        }
      });

      this.jupiterWS.on('close', (code: number, reason: string) => {
        logger.warn(`🔌 Jupiter WebSocket disconnected: ${code} ${reason}`);
        this.wsConnected = false;
        
        // SECURITY: Log WebSocket disconnection
        securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Price Monitoring',
          eventType: SECURITY_EVENT_TYPES.PRICE_WEBSOCKET_DISCONNECTED,
          message: 'Jupiter WebSocket connection lost',
          details: {
            code,
            reason,
            uptime: Date.now() - this.serviceStartTime,
            trackedTokens: this.trackedMints.size,
          },
          source: 'price-service',
        });
        
        this.scheduleReconnect();
      });

      this.jupiterWS.on('error', (error: Error) => {
        logger.error('🔌 Jupiter WebSocket error:', { error: error instanceof Error ? error.message : String(error) });
        this.wsConnected = false;
        
        // SECURITY: Log WebSocket errors
        securityMonitor.log({
          severity: 'HIGH',
          category: 'Price Monitoring',
          eventType: SECURITY_EVENT_TYPES.PRICE_WEBSOCKET_ERROR,
          message: `Jupiter WebSocket error: ${error.message}`,
          details: {
            error: error.message,
            stack: error.stack?.slice(0, 500),
            trackedTokens: this.trackedMints.size,
            connectionAttempts: this.wsReconnectAttempts,
          },
          source: 'price-service',
        });
      });

    } catch (error: any) {
      logger.error('Failed to initialize Jupiter WebSocket:', { error: error instanceof Error ? error.message : String(error) });
      
      // SECURITY: Log WebSocket initialization failure
      securityMonitor.log({
        severity: 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_WEBSOCKET_INIT_FAILED,
        message: `Failed to initialize Jupiter WebSocket: ${error.message}`,
        details: {
          error: error.message,
          stack: error.stack?.slice(0, 500),
        },
        source: 'price-service',
      });
    }
  }

  /**
   * SECURITY: Handle real-time price updates from Jupiter WebSocket
   */
  private async handlePriceUpdate(update: JupiterWSPriceUpdate): Promise<void> {
    try {
      const priceValue = parseFloat(update.price);
      
      // SECURITY: Validate price data
      if (isNaN(priceValue) || priceValue <= 0 || priceValue > 1000000) {
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Price Monitoring',
          eventType: SECURITY_EVENT_TYPES.PRICE_INVALID_DATA,
          message: 'Invalid price data received from WebSocket',
          details: {
            tokenMint: update.id,
            price: update.price,
            timestamp: update.timestamp,
          },
          source: 'price-service',
        });
        return;
      }
      
      // Check for extreme price movements
      const cached = this.cache.get(update.id);
      if (cached) {
        const oldPrice = cached.data.usdPrice;
        const priceChange = Math.abs((priceValue - oldPrice) / oldPrice);
        
        if (priceChange > 0.5) { // 50% price movement
          await securityMonitor.log({
            severity: 'HIGH',
            category: 'Price Monitoring',
            eventType: SECURITY_EVENT_TYPES.PRICE_EXTREME_MOVEMENT,
            message: `Extreme price movement detected: ${(priceChange * 100).toFixed(1)}%`,
            details: {
              tokenMint: update.id,
              oldPrice,
              newPrice: priceValue,
              changePercent: priceChange * 100,
              timeDelta: Date.now() - cached.timestamp,
            },
            source: 'price-service',
          });
        }
      }
      
      const extendedData: ExtendedPriceData = {
        mint: update.id,
        usdPrice: priceValue,
        source: 'jupiter-ws',
        timestamp: update.timestamp || Date.now(),
      };

      // Update cache with real-time data
      this.cache.set(update.id, { data: extendedData, timestamp: Date.now() });
      
      // Also cache in Redis
      redis.setex(`price:${update.id}`, 5, JSON.stringify(extendedData));
      
      logger.debug(`📈 Real-time price update: ${update.id} = $${update.price}`);
      
      // CHECK FOR LIQUIDATIONS IMMEDIATELY
      this.checkLiquidationThresholds(update.id, priceValue);
    } catch (error: any) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_UPDATE_FAILED,
        message: `Failed to handle price update: ${error.message}`,
        details: {
          tokenMint: update.id,
          price: update.price,
          error: error.message,
        },
        source: 'price-service',
      });
    }
  }

  /**
   * SECURITY: Check if any loans need immediate liquidation based on price update
   */
  private async checkLiquidationThresholds(mint: string, usdPrice: number): Promise<void> {
    try {
      // Get SOL price to convert USD to SOL
      const solPrice = await this.getSolPrice();
      const priceInSol = usdPrice / solPrice;
      
      // Get all active loans for this token
      const loans = await prisma.loan.findMany({
        where: { 
          tokenMint: mint, 
          status: 'active' 
        },
        select: {
          id: true,
          liquidationPrice: true,
          borrower: true,
        }
      });
      
      for (const loan of loans) {
        const liquidationPrice = parseFloat(loan.liquidationPrice);
        if (priceInSol <= liquidationPrice) {
          console.log(`🚨 URGENT: Loan ${loan.id} hit liquidation threshold!`);
          console.log(`📊 Current: $${usdPrice} (${priceInSol} SOL) <= Threshold: ${liquidationPrice} SOL`);
          
          // Trigger immediate liquidation (don't wait for job)
          this.triggerUrgentLiquidation(loan.id, priceInSol, liquidationPrice);
        }
      }
    } catch (error: any) {
      logger.error('Failed to check liquidation thresholds:', { error: error instanceof Error ? error.message : String(error) });
      
      // SECURITY: Log liquidation check failures
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_LIQUIDATION_CHECK_FAILED,
        message: `Failed to check liquidation thresholds: ${error.message}`,
        details: {
          tokenMint: mint,
          usdPrice,
          error: error.message,
        },
        source: 'price-service',
      });
    }
  }

  /**
   * SECURITY: Trigger urgent liquidation for critical price drops
   */
  private async triggerUrgentLiquidation(loanId: string, price: number, threshold: number): Promise<void> {
    try {
      const liquidatorWallet = process.env.LIQUIDATOR_WALLET || process.env.ADMIN_WALLET;
      
      if (!liquidatorWallet) {
        console.error('❌ No liquidator wallet configured for urgent liquidation');
        return;
      }
      
      console.log(`⚡ Triggering URGENT liquidation for loan ${loanId}`);
      
      // Import loan service dynamically to avoid circular dependency
      const { loanService } = await import('./loan.service.js');
      await loanService.liquidateLoan(loanId, liquidatorWallet);
      
      console.log(`✅ URGENT liquidation completed for ${loanId}`);
      
    } catch (error) {
      console.error(`❌ Urgent liquidation failed for ${loanId}:`, error);
    }
  }

  /**
   * SECURITY: Subscribe to tracked tokens for WebSocket updates
   */
  private subscribeToTrackedTokens(): void {
    if (!this.jupiterWS || !this.wsConnected || this.trackedMints.size === 0) {
      return;
    }

    const subscriptionMessage = {
      method: 'subscribe',
      params: {
        ids: Array.from(this.trackedMints),
      },
    };

    this.jupiterWS.send(JSON.stringify(subscriptionMessage));
    logger.info(`📡 Subscribed to ${this.trackedMints.size} tokens via WebSocket`);
  }

  /**
   * SECURITY: Add token to real-time tracking
   */
  public trackToken(mint: string): void {
    this.trackedMints.add(mint);
    
    // If WebSocket is connected, subscribe immediately
    if (this.wsConnected && this.jupiterWS) {
      const subscriptionMessage = {
        method: 'subscribe',
        params: {
          ids: [mint],
        },
      };
      this.jupiterWS.send(JSON.stringify(subscriptionMessage));
      logger.info(`📡 Added ${mint} to real-time tracking`);
    }
  }

  /**
   * SECURITY: Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.wsReconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('🔌 Max WebSocket reconnection attempts reached');
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 30000);
    this.wsReconnectAttempts++;

    logger.info(`🔌 Reconnecting Jupiter WebSocket in ${backoffMs}ms (attempt ${this.wsReconnectAttempts})`);
    
    setTimeout(() => {
      this.initializeJupiterWebSocket();
    }, backoffMs);
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
      logger.warn('Failed to fetch from Jupiter:', { error: error instanceof Error ? error.message : String(error) });
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
        logger.warn(`Failed to fetch ${mint} from PumpFun:`, { error: error instanceof Error ? error.message : String(error) });
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
        logger.warn(`Failed to fetch ${mint} from DexScreener:`, { error: error instanceof Error ? error.message : String(error) });
      }
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
          pumpFunAvailable: this.pumpFunAvailable,
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
        logger.error('Failed to initialize PumpFun SDK:', { error: error instanceof Error ? error.message : String(error) });
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
      logger.warn(`Failed to fetch ${mint} from PumpFun:`, { error: error instanceof Error ? error.message : String(error) });
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
          const price = data[solMint]!.usdPrice;
          
          const priceData: ExtendedPriceData = {
            mint: solMint,
            usdPrice: price,
            priceChange24h: data[solMint]!.priceChange24h || undefined,
            source: 'jupiter',
            timestamp: Date.now(),
          };
          
          this.cache.set(solMint, { data: priceData, timestamp: Date.now() });
          return price;
        }
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
          usdPrice: priceData.usdPrice,
          priceChange24h: priceData.priceChange24h || undefined,
          decimals: priceData.decimals,
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
      jupiterWebSocketConnected: this.wsConnected,
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
      
      // SECURITY: Track all enabled tokens for real-time monitoring
      for (const mint of mints) {
        this.trackToken(mint);
      }
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