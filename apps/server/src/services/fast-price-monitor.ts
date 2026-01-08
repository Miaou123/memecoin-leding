/**
 * Fast Price Monitor Service
 * 
 * Polls price APIs with fallback chain: Jupiter → DexScreener
 * Checks liquidation thresholds and triggers immediate liquidation.
 * Sends Telegram alerts on price source failover.
 */

import { EventEmitter } from 'events';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { jupiterClient } from './jupiter-client.js';

// Price scaling constant - matches on-chain storage format
const PRICE_SCALE_DIVISOR = 1_000_000; // 1e6

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v3';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';
const POLL_INTERVAL_MS = parseInt(process.env.PRICE_POLL_INTERVAL_MS || '5000'); // 5 seconds default
const MAX_MINTS_PER_REQUEST = 50; // Jupiter limit
const PRICE_SOURCE_SWITCH_THRESHOLD = 3; // Switch sources after 3 consecutive failures

export interface PriceData {
  mint: string;
  usdPrice: number;
  solPrice: number;
  timestamp: number;
  blockId?: number;
}

export interface LiquidationAlert {
  loanId: string;
  tokenMint: string;
  currentPrice: number;
  liquidationPrice: number;
  priceDropPercent: number;
  timestamp: number;
}

interface LiquidationThreshold {
  loanId: string;
  liquidationPrice: number; // In SOL per token
  borrower: string;
  solBorrowed: number;
  entryPrice: number;
}

interface TokenMonitor {
  mint: string;
  thresholds: LiquidationThreshold[];
  lastPrice: number;
  lastUpdate: number;
}

class FastPriceMonitor extends EventEmitter {
  private monitors: Map<string, TokenMonitor> = new Map();
  private priceCache: Map<string, PriceData> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private solPrice: number = 0;
  private lastSolPriceUpdate: number = 0;
  private consecutiveErrors: number = 0;
  private maxConsecutiveErrors: number = 10;
  private currentPriceSource: 'jupiter' | 'dexscreener' = 'jupiter';
  private sourceFailures: Map<string, number> = new Map();
  private lastSourceAlert: number = 0;
  
  constructor() {
    super();
    
    console.log('🔌 Fast Price Monitor initialized');
    console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms`);
    console.log(`   Primary API: Jupiter (via multi-key client)`);
    console.log(`   Fallback API: ${DEXSCREENER_API}`);
  }
  
  /**
   * Start the price monitoring loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Fast Price Monitor already running');
      return;
    }
    
    console.log('🚀 Starting Fast Price Monitor...');
    
    // Get initial SOL price
    await this.updateSolPrice();
    
    this.isRunning = true;
    this.consecutiveErrors = 0;
    
    // Start polling loop
    this.pollInterval = setInterval(async () => {
      await this.pollPrices();
    }, POLL_INTERVAL_MS);
    
    // Initial poll
    await this.pollPrices();
    
    console.log('✅ Fast Price Monitor started');
    this.emit('started');
  }
  
  /**
   * Stop the price monitoring loop
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Fast Price Monitor stopped');
    this.emit('stopped');
  }
  
  /**
   * Update SOL/USD price (needed to convert token prices)
   */
  private async updateSolPrice(): Promise<void> {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    
    try {
      const prices = await jupiterClient.fetchPrices([SOL_MINT]);
      
      if (prices[SOL_MINT]?.price) {
        this.solPrice = prices[SOL_MINT].price;
        this.lastSolPriceUpdate = Date.now();
      }
    } catch (error: any) {
      console.error('❌ Failed to fetch SOL price:', error.message);
      
      // SECURITY: Log SOL price fetch failures
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_API_ERROR,
        message: `Failed to fetch SOL price for fast monitor: ${error.message}`,
        details: {
          api: 'jupiter',
          endpoint: 'price/v3',
          mint: 'SOL',
          error: error.message,
        },
        source: 'fast-price-monitor',
      });
    }
  }
  
  /**
   * Poll prices for all monitored tokens
   */
  private async pollPrices(): Promise<void> {
    const mints = Array.from(this.monitors.keys());
    
    if (mints.length === 0) {
      return; // Nothing to monitor
    }
    
    // Update SOL price every 30 seconds
    if (Date.now() - this.lastSolPriceUpdate > 30000) {
      await this.updateSolPrice();
    }
    
    try {
      // Batch mints into groups of 50 (Jupiter limit)
      const batches: string[][] = [];
      for (let i = 0; i < mints.length; i += MAX_MINTS_PER_REQUEST) {
        batches.push(mints.slice(i, i + MAX_MINTS_PER_REQUEST));
      }
      
      for (const batch of batches) {
        await this.fetchPriceBatch(batch);
      }
      
      this.consecutiveErrors = 0;
      
    } catch (error: any) {
      this.consecutiveErrors++;
      console.error(`❌ Price poll failed (${this.consecutiveErrors}/${this.maxConsecutiveErrors}):`, error.message);
      
      // SECURITY: Log consecutive API errors
      await securityMonitor.log({
        severity: this.consecutiveErrors >= 5 ? 'CRITICAL' : 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_API_ERROR,
        message: `Fast price monitor API failure (${this.consecutiveErrors} consecutive)`,
        details: {
          consecutiveErrors: this.consecutiveErrors,
          maxErrors: this.maxConsecutiveErrors,
          monitoredTokens: this.monitors.size,
          error: error.message,
        },
        source: 'fast-price-monitor',
      });
      
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.error('🚨 Too many consecutive errors - stopping monitor');
        
        // SECURITY: Alert when monitor stops due to errors
        await securityMonitor.log({
          severity: 'CRITICAL',
          category: 'Price Monitoring',
          eventType: SECURITY_EVENT_TYPES.PRICE_MONITOR_STOPPED,
          message: 'Fast price monitor stopped due to consecutive API failures',
          details: {
            consecutiveErrors: this.consecutiveErrors,
            monitoredTokens: this.monitors.size,
            totalThresholds: Array.from(this.monitors.values()).reduce((sum, m) => sum + m.thresholds.length, 0),
          },
          source: 'fast-price-monitor',
        });
        
        this.stop();
        this.emit('error', new Error('Too many consecutive poll failures'));
      }
    }
  }
  
  /**
   * Fetch prices for a batch of token mints
   */
  private async fetchPriceBatch(mints: string[]): Promise<void> {
    const now = Date.now();
    let priceData: Record<string, any> = {};
    let sourceUsed: 'jupiter' | 'dexscreener' = this.currentPriceSource;
    
    // Try current source first
    try {
      if (this.currentPriceSource === 'jupiter') {
        priceData = await this.fetchFromJupiter(mints);
      } else {
        priceData = await this.fetchFromDexScreener(mints);
      }
      
      // Reset failure count on success
      this.sourceFailures.set(sourceUsed, 0);
      this.consecutiveErrors = 0;
      
    } catch (primaryError: any) {
      console.error(`❌ ${sourceUsed} API failed:`, primaryError.message);
      
      // Increment failure count
      const failures = (this.sourceFailures.get(sourceUsed) || 0) + 1;
      this.sourceFailures.set(sourceUsed, failures);
      
      // Try fallback source
      const fallbackSource = sourceUsed === 'jupiter' ? 'dexscreener' : 'jupiter';
      
      try {
        console.log(`🔄 Trying fallback source: ${fallbackSource}`);
        
        if (fallbackSource === 'jupiter') {
          priceData = await this.fetchFromJupiter(mints);
        } else {
          priceData = await this.fetchFromDexScreener(mints);
        }
        
        sourceUsed = fallbackSource;
        
        // Switch primary source if threshold exceeded
        if (failures >= PRICE_SOURCE_SWITCH_THRESHOLD) {
          this.currentPriceSource = fallbackSource;
          console.log(`🔄 Switched primary price source to ${fallbackSource}`);
          
          // Alert on source switch (rate limited to once per 5 minutes)
          if (now - this.lastSourceAlert > 300000) {
            this.lastSourceAlert = now;
            
            await securityMonitor.log({
              severity: 'MEDIUM',
              category: 'Price Monitoring',
              eventType: SECURITY_EVENT_TYPES.PRICE_SOURCE_FAILOVER,
              message: `Price monitor switched from ${this.currentPriceSource === 'jupiter' ? 'DexScreener' : 'Jupiter'} to ${fallbackSource} after ${failures} failures`,
              details: {
                previousSource: this.currentPriceSource === 'jupiter' ? 'dexscreener' : 'jupiter',
                newSource: fallbackSource,
                consecutiveFailures: failures,
                monitoredTokens: this.monitors.size,
              },
              source: 'fast-price-monitor',
            });
          }
          
          // Reset failure count after switch
          this.sourceFailures.set(sourceUsed, 0);
        }
        
      } catch (fallbackError: any) {
        console.error(`❌ Fallback ${fallbackSource} also failed:`, fallbackError.message);
        
        // Both sources failed - this is critical
        await securityMonitor.log({
          severity: 'CRITICAL',
          category: 'Price Monitoring',
          eventType: SECURITY_EVENT_TYPES.PRICE_API_ERROR,
          message: 'All price sources failed - no price data available',
          details: {
            primaryError: primaryError.message,
            fallbackError: fallbackError.message,
            tokensAffected: mints.length,
            monitoredTokens: this.monitors.size,
          },
          source: 'fast-price-monitor',
        });
        
        throw fallbackError;
      }
    }
    
    // Process price data
    for (const [mint, info] of Object.entries(priceData)) {
      if (!info?.usdPrice) continue;
      
      // Calculate SOL price from USD price
      const solPrice = this.solPrice > 0 
        ? info.usdPrice / this.solPrice 
        : 0;
      
      const priceDataEntry: PriceData = {
        mint,
        usdPrice: info.usdPrice,
        solPrice,
        timestamp: now,
        blockId: info.blockId,
      };
      
      // Update cache
      const previousPrice = this.priceCache.get(mint);
      this.priceCache.set(mint, priceDataEntry);
      
      // Update monitor
      const monitor = this.monitors.get(mint);
      if (monitor) {
        monitor.lastPrice = solPrice;
        monitor.lastUpdate = now;
        
        // Log significant price changes (>2%)
        if (previousPrice && previousPrice.solPrice > 0) {
          const change = ((solPrice - previousPrice.solPrice) / previousPrice.solPrice) * 100;
          if (Math.abs(change) > 2) {
            console.log(`📊 ${mint.slice(0, 8)}... ${solPrice.toExponential(4)} SOL (${change > 0 ? '+' : ''}${change.toFixed(2)}%) [${sourceUsed}]`);
          }
        }
        
        // Check liquidation thresholds
        this.checkThresholds(mint, solPrice);
      }
    }
    
    this.emit('prices-updated', { 
      count: Object.keys(priceData).length, 
      timestamp: now, 
      source: sourceUsed 
    });
  }
  
  /**
   * Fetch prices from Jupiter API
   */
  private async fetchFromJupiter(mints: string[]): Promise<Record<string, any>> {
    const prices = await jupiterClient.fetchPrices(mints);
    
    // Transform to expected format for v3 API
    const result: Record<string, any> = {};
    for (const [mint, data] of Object.entries(prices)) {
      result[mint] = {
        id: mint,
        usdPrice: data.price,
        price: data.price.toString(),
        extraInfo: data.extraInfo,
      };
    }
    
    return result;
  }
  
  /**
   * Fetch prices from DexScreener API  
   */
  private async fetchFromDexScreener(mints: string[]): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    
    // DexScreener requires individual requests per token
    for (const mint of mints) {
      try {
        const url = `${DEXSCREENER_API}/${mint}`;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(3000),
        });
        
        if (!response.ok) {
          console.warn(`DexScreener failed for ${mint}: ${response.status}`);
          continue;
        }
        
        const data: any = await response.json();
        
        if (data.pairs && data.pairs.length > 0) {
          // Get the pair with highest liquidity
          const bestPair = data.pairs.reduce((best: any, current: any) => {
            return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
          });
          
          results[mint] = {
            usdPrice: parseFloat(bestPair.priceUsd),
            priceChange24h: bestPair.priceChange?.h24,
          };
        }
      } catch (error) {
        console.warn(`Failed to fetch ${mint} from DexScreener:`, error);
      }
    }
    
    if (Object.keys(results).length === 0) {
      throw new Error('DexScreener returned no price data');
    }
    
    return results;
  }
  
  /**
   * Check liquidation thresholds for a token
   */
  private checkThresholds(mint: string, currentPrice: number): void {
    const monitor = this.monitors.get(mint);
    if (!monitor || monitor.thresholds.length === 0) return;
    
    for (const threshold of monitor.thresholds) {
      // CRITICAL BUG FIX: Prices must be in same units!
      // threshold.liquidationPrice is in scaled format (e.g., 4305 = 0.004305 SOL)
      // currentPrice is in human-readable format (e.g., 0.000763 SOL)
      
      // First, add sanity check for on-chain bug
      if (threshold.liquidationPrice > threshold.entryPrice) {
        console.warn(`⚠️ BUG DETECTED: Loan ${threshold.loanId.slice(0, 8)}... has invalid liquidation config`);
        console.warn(`   entry_price: ${threshold.entryPrice} (scaled), liquidation_price: ${threshold.liquidationPrice} (scaled)`);
        console.warn(`   liquidation_price should be < entry_price`);
        console.warn(`   Skipping this loan until on-chain bug is fixed`);
        continue; // Skip this loan - don't trigger false liquidation
      }
      
      // Convert currentPrice to scaled format for comparison
      const currentPriceScaled = Math.round(currentPrice * PRICE_SCALE_DIVISOR);
      
      if (currentPriceScaled <= threshold.liquidationPrice) {
        console.log(`💸 Price comparison (scaled units):`);
        console.log(`   Current: ${currentPriceScaled} (${currentPrice.toFixed(8)} SOL)`);
        console.log(`   Liquidation: ${threshold.liquidationPrice} (${(threshold.liquidationPrice / PRICE_SCALE_DIVISOR).toFixed(8)} SOL)`);
        this.triggerLiquidation(mint, threshold, currentPrice);
      }
    }
  }
  
  /**
   * Trigger liquidation for a loan
   */
  private async triggerLiquidation(
    mint: string,
    threshold: LiquidationThreshold,
    currentPrice: number
  ): Promise<void> {
    // Fix price drop calculation - convert to same units
    const entryPriceHuman = threshold.entryPrice / PRICE_SCALE_DIVISOR;
    const currentPriceHuman = currentPrice; // already human readable
    const liquidationPriceHuman = threshold.liquidationPrice / PRICE_SCALE_DIVISOR;
    const priceDropPercent = ((entryPriceHuman - currentPriceHuman) / entryPriceHuman) * 100;
    
    const alert: LiquidationAlert = {
      loanId: threshold.loanId,
      tokenMint: mint,
      currentPrice,
      liquidationPrice: threshold.liquidationPrice,
      priceDropPercent,
      timestamp: Date.now(),
    };
    
    console.log(`🚨 ════════════════════════════════════════════`);
    console.log(`🚨 LIQUIDATION TRIGGERED!`);
    console.log(`🚨 Loan: ${threshold.loanId}`);
    console.log(`🚨 Token: ${mint.slice(0, 8)}...`);
    console.log(`🚨 Current Price: ${currentPrice.toFixed(8)} SOL (scaled: ${Math.round(currentPrice * PRICE_SCALE_DIVISOR)})`);
    console.log(`🚨 Liquidation Price: ${liquidationPriceHuman.toFixed(8)} SOL (scaled: ${threshold.liquidationPrice})`);
    console.log(`🚨 Entry Price: ${entryPriceHuman.toFixed(8)} SOL (scaled: ${threshold.entryPrice})`);
    console.log(`🚨 Drop from entry: ${priceDropPercent.toFixed(2)}%`);
    console.log(`🚨 ════════════════════════════════════════════`);
    
    // SECURITY: Log liquidation triggers
    await securityMonitor.log({
      severity: 'CRITICAL',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_TRIGGERED,
      message: `Price-based liquidation triggered for loan ${threshold.loanId.slice(0, 8)}...`,
      details: {
        loanId: threshold.loanId,
        tokenMint: mint,
        currentPrice,
        liquidationPrice: threshold.liquidationPrice,
        entryPrice: threshold.entryPrice,
        priceDropPercent,
        borrower: threshold.borrower,
        solBorrowed: threshold.solBorrowed,
      },
      source: 'fast-price-monitor',
      userId: threshold.borrower,
    });
    
    this.emit('liquidation-alert', alert);
    
    // Attempt immediate liquidation
    try {
      const { loanService } = await import('./loan.service.js');
      
      // Load liquidator keypair from file
      let liquidatorWallet: string;
      try {
        const { getLiquidatorPublicKey } = await import('../config/keys.js');
        liquidatorWallet = getLiquidatorPublicKey();
      } catch (error: any) {
        console.error('❌ Failed to load liquidator keypair:', error.message);
        return;
      }
      
      console.log(`⚡ Executing liquidation for ${threshold.loanId.slice(0, 8)}...`);
      await loanService.liquidateLoan(threshold.loanId, liquidatorWallet);
      
      console.log(`✅ Liquidation successful for ${threshold.loanId.slice(0, 8)}...`);
      
      // Remove threshold after successful liquidation
      this.removeLiquidationThreshold(mint, threshold.loanId);
      
    } catch (error: any) {
      console.error(`❌ Liquidation failed for ${threshold.loanId.slice(0, 8)}...:`, error.message);
      
      // SECURITY: Log liquidation failures
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Liquidation',
        eventType: SECURITY_EVENT_TYPES.LIQUIDATION_FAILED,
        message: `Fast monitor liquidation failed: ${error.message}`,
        details: {
          loanId: threshold.loanId,
          tokenMint: mint,
          currentPrice,
          liquidationPrice: threshold.liquidationPrice,
          borrower: threshold.borrower,
          error: error.message,
          stack: error.stack?.slice(0, 500),
        },
        source: 'fast-price-monitor',
        userId: threshold.borrower,
      });
      
      this.emit('liquidation-failed', { alert, error: error.message });
    }
  }
  
  /**
   * Register a token for monitoring
   */
  trackToken(mint: string): void {
    if (this.monitors.has(mint)) return;
    
    this.monitors.set(mint, {
      mint,
      thresholds: [],
      lastPrice: 0,
      lastUpdate: 0,
    });
    
    console.log(`📡 Tracking token: ${mint.slice(0, 8)}...`);
  }
  
  /**
   * Register a loan's liquidation threshold
   */
  registerLiquidationThreshold(
    mint: string,
    loanId: string,
    liquidationPrice: number,
    borrower: string,
    solBorrowed: number,
    entryPrice: number
  ): void {
    // Ensure token is tracked
    if (!this.monitors.has(mint)) {
      this.trackToken(mint);
    }
    
    const monitor = this.monitors.get(mint)!;
    
    // Check if already registered
    if (monitor.thresholds.some(t => t.loanId === loanId)) {
      console.log(`🎯 Threshold already registered for loan ${loanId.slice(0, 8)}...`);
      return;
    }
    
    monitor.thresholds.push({
      loanId,
      liquidationPrice,
      borrower,
      solBorrowed,
      entryPrice,
    });
    
    // Add sanity check
    if (liquidationPrice > entryPrice) {
      console.warn(`⚠️ WARNING: Invalid liquidation configuration detected!`);
      console.warn(`   Loan: ${loanId.slice(0, 8)}...`);
      console.warn(`   Entry Price: ${entryPrice} (scaled) = ${(entryPrice / PRICE_SCALE_DIVISOR).toFixed(8)} SOL`);
      console.warn(`   Liquidation Price: ${liquidationPrice} (scaled) = ${(liquidationPrice / PRICE_SCALE_DIVISOR).toFixed(8)} SOL`);
      console.warn(`   liquidation_price should be < entry_price`);
      console.warn(`   This loan will be skipped to prevent false liquidations`);
    }
    
    console.log(`🎯 Registered liquidation threshold:`);
    console.log(`   Loan: ${loanId.slice(0, 8)}...`);
    console.log(`   Token: ${mint.slice(0, 8)}...`);
    console.log(`   Entry Price: ${(entryPrice / PRICE_SCALE_DIVISOR).toFixed(8)} SOL (scaled: ${entryPrice})`);
    console.log(`   Liquidation Price: ${(liquidationPrice / PRICE_SCALE_DIVISOR).toFixed(8)} SOL (scaled: ${liquidationPrice})`);
    console.log(`   Current Price: ${monitor.lastPrice > 0 ? `${monitor.lastPrice.toFixed(8)} SOL` : 'pending...'}`);
    
    if (monitor.lastPrice > 0) {
      // Convert to same units for comparison
      const currentPriceScaled = Math.round(monitor.lastPrice * PRICE_SCALE_DIVISOR);
      const buffer = ((currentPriceScaled - liquidationPrice) / liquidationPrice) * 100;
      console.log(`   Buffer: ${buffer.toFixed(2)}% above liquidation`);
      
      // Check immediately if already below threshold
      if (currentPriceScaled <= liquidationPrice) {
        console.log(`⚠️ Price already at or below liquidation threshold!`);
        const threshold = monitor.thresholds.find(t => t.loanId === loanId)!;
        this.triggerLiquidation(mint, threshold, monitor.lastPrice);
      }
    }
  }
  
  /**
   * Remove a loan's liquidation threshold
   */
  removeLiquidationThreshold(mint: string, loanId: string): void {
    const monitor = this.monitors.get(mint);
    if (!monitor) return;
    
    const initialLength = monitor.thresholds.length;
    monitor.thresholds = monitor.thresholds.filter(t => t.loanId !== loanId);
    
    if (monitor.thresholds.length < initialLength) {
      console.log(`🗑️ Removed threshold for loan ${loanId.slice(0, 8)}...`);
    }
    
    // If no more thresholds, optionally stop tracking
    // (keeping it is fine for monitoring)
  }
  
  /**
   * Get current price for a token
   */
  getPrice(mint: string): PriceData | undefined {
    return this.priceCache.get(mint);
  }
  
  /**
   * Get current SOL/USD price
   */
  getSolPrice(): number {
    return this.solPrice;
  }
  
  /**
   * Get monitoring status
   */
  getStatus(): {
    isRunning: boolean;
    tokensMonitored: number;
    totalThresholds: number;
    solPrice: number;
    tokens: { mint: string; thresholds: number; lastPrice: number; lastUpdate: number }[];
  } {
    const tokens = Array.from(this.monitors.values()).map(m => ({
      mint: m.mint,
      thresholds: m.thresholds.length,
      lastPrice: m.lastPrice,
      lastUpdate: m.lastUpdate,
    }));
    
    return {
      isRunning: this.isRunning,
      tokensMonitored: this.monitors.size,
      totalThresholds: tokens.reduce((sum, t) => sum + t.thresholds, 0),
      solPrice: this.solPrice,
      tokens,
    };
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down Fast Price Monitor...');
    this.stop();
    this.monitors.clear();
    this.priceCache.clear();
    console.log('✅ Fast Price Monitor shut down');
  }
}

// Export singleton instance
export const fastPriceMonitor = new FastPriceMonitor();

/**
 * Initialize fast price monitoring
 * Call this on server startup
 */
export async function initializeFastPriceMonitor(loanService?: any): Promise<void> {
  try {
    console.log('🚀 Initializing Fast Price Monitor...');
    
    // Load active loans and register their liquidation thresholds
    if (loanService) {
      const activeLoans = await loanService.getActiveLoans();
      console.log(`📋 Loading ${activeLoans.length} active loans for monitoring...`);
      
      for (const loan of activeLoans) {
        // Register threshold for monitoring
        fastPriceMonitor.registerLiquidationThreshold(
          loan.tokenMint,
          loan.id,
          parseFloat(loan.liquidationPrice),
          loan.borrower,
          parseFloat(loan.solBorrowed),
          parseFloat(loan.entryPrice)
        );
      }
    }
    
    // Start the monitor
    await fastPriceMonitor.start();
    
    console.log('✅ Fast Price Monitor initialized');
    
    // Log status
    const status = fastPriceMonitor.getStatus();
    console.log(`   📊 Monitoring ${status.tokensMonitored} tokens`);
    console.log(`   🎯 ${status.totalThresholds} liquidation thresholds`);
    console.log(`   💰 SOL price: ${status.solPrice.toFixed(2)}`);
    
    // Setup event handlers
    fastPriceMonitor.on('liquidation-failed', async ({ alert, error }) => {
      console.error('❌ Liquidation failed, queuing for retry:', error);
      
      // Add to job queue for retry
      try {
        const { liquidationQueue } = await import('../jobs/index.js');
        await liquidationQueue.add(
          'retry-liquidation',
          { 
            loanId: alert.loanId, 
            attempt: 1,
            reason: 'price',
          },
          { 
            priority: 1, 
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          }
        );
      } catch (queueError) {
        console.error('Failed to queue retry:', queueError);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize Fast Price Monitor:', error);
    throw error;
  }
}

export default fastPriceMonitor;