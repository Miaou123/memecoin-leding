/**
 * Fast Price Monitor Service
 * 
 * Polls Jupiter Price API every 1 second for real-time-ish price updates.
 * Checks liquidation thresholds and triggers immediate liquidation.
 * 
 * This replaces any fake WebSocket implementations.
 */

import { EventEmitter } from 'events';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v3';
const POLL_INTERVAL_MS = 5000; // 5 seconds (development mode)
const MAX_MINTS_PER_REQUEST = 50; // Jupiter limit

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
  private apiKey: string;
  private consecutiveErrors: number = 0;
  private maxConsecutiveErrors: number = 10;
  
  constructor() {
    super();
    this.apiKey = process.env.JUPITER_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('⚠️ JUPITER_API_KEY not set - rate limits will be stricter');
    }
    
    console.log('🔌 Fast Price Monitor initialized');
    console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms (development mode)`);
    console.log(`   API: ${JUPITER_PRICE_API}`);
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
      const response = await fetch(
        `${JUPITER_PRICE_API}?ids=${SOL_MINT}`,
        {
          headers: this.apiKey ? { 'x-api-key': this.apiKey } : {},
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json() as Record<string, { usdPrice: number }>;
      
      if (data[SOL_MINT]?.usdPrice) {
        this.solPrice = data[SOL_MINT].usdPrice;
        this.lastSolPriceUpdate = Date.now();
      }
    } catch (error: any) {
      console.error('❌ Failed to fetch SOL price:', error.message);
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
      
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.error('🚨 Too many consecutive errors - stopping monitor');
        this.stop();
        this.emit('error', new Error('Too many consecutive poll failures'));
      }
    }
  }
  
  /**
   * Fetch prices for a batch of token mints
   */
  private async fetchPriceBatch(mints: string[]): Promise<void> {
    const url = `${JUPITER_PRICE_API}?ids=${mints.join(',')}`;
    
    const response = await fetch(url, {
      headers: this.apiKey ? { 'x-api-key': this.apiKey } : {},
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('⚠️ Rate limited by Jupiter API');
        await new Promise(r => setTimeout(r, 1000)); // Back off 1 second
      }
      throw new Error(`Jupiter API error: ${response.status}`);
    }
    
    const data = await response.json() as Record<string, { 
      usdPrice: number; 
      blockId?: number;
      decimals?: number;
    }>;
    
    const now = Date.now();
    
    for (const [mint, priceInfo] of Object.entries(data)) {
      if (!priceInfo?.usdPrice) continue;
      
      // Calculate SOL price from USD price
      const solPrice = this.solPrice > 0 
        ? priceInfo.usdPrice / this.solPrice 
        : 0;
      
      const priceData: PriceData = {
        mint,
        usdPrice: priceInfo.usdPrice,
        solPrice,
        timestamp: now,
        blockId: priceInfo.blockId,
      };
      
      // Update cache
      const previousPrice = this.priceCache.get(mint);
      this.priceCache.set(mint, priceData);
      
      // Update monitor
      const monitor = this.monitors.get(mint);
      if (monitor) {
        monitor.lastPrice = solPrice;
        monitor.lastUpdate = now;
        
        // Log significant price changes (>2%)
        if (previousPrice && previousPrice.solPrice > 0) {
          const change = ((solPrice - previousPrice.solPrice) / previousPrice.solPrice) * 100;
          if (Math.abs(change) > 2) {
            console.log(`📊 ${mint.slice(0, 8)}... ${solPrice.toExponential(4)} SOL (${change > 0 ? '+' : ''}${change.toFixed(2)}%)`);
          }
        }
        
        // Check liquidation thresholds
        this.checkThresholds(mint, solPrice);
      }
    }
    
    this.emit('prices-updated', { count: Object.keys(data).length, timestamp: now });
  }
  
  /**
   * Check liquidation thresholds for a token
   */
  private checkThresholds(mint: string, currentPrice: number): void {
    const monitor = this.monitors.get(mint);
    if (!monitor || monitor.thresholds.length === 0) return;
    
    for (const threshold of monitor.thresholds) {
      if (currentPrice <= threshold.liquidationPrice) {
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
    const priceDropPercent = ((threshold.entryPrice - currentPrice) / threshold.entryPrice) * 100;
    
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
    console.log(`🚨 Current Price: ${currentPrice.toExponential(4)} SOL`);
    console.log(`🚨 Liquidation Price: ${threshold.liquidationPrice.toExponential(4)} SOL`);
    console.log(`🚨 Entry Price: ${threshold.entryPrice.toExponential(4)} SOL`);
    console.log(`🚨 Drop from entry: ${priceDropPercent.toFixed(2)}%`);
    console.log(`🚨 ════════════════════════════════════════════`);
    
    this.emit('liquidation-alert', alert);
    
    // Attempt immediate liquidation
    try {
      const { loanService } = await import('./loan.service.js');
      
      const liquidatorWallet = process.env.LIQUIDATOR_WALLET || process.env.ADMIN_WALLET;
      if (!liquidatorWallet) {
        console.error('❌ No liquidator wallet configured!');
        return;
      }
      
      console.log(`⚡ Executing liquidation for ${threshold.loanId.slice(0, 8)}...`);
      await loanService.liquidateLoan(threshold.loanId, liquidatorWallet);
      
      console.log(`✅ Liquidation successful for ${threshold.loanId.slice(0, 8)}...`);
      
      // Remove threshold after successful liquidation
      this.removeLiquidationThreshold(mint, threshold.loanId);
      
    } catch (error: any) {
      console.error(`❌ Liquidation failed for ${threshold.loanId.slice(0, 8)}...:`, error.message);
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
    
    console.log(`🎯 Registered liquidation threshold:`);
    console.log(`   Loan: ${loanId.slice(0, 8)}...`);
    console.log(`   Token: ${mint.slice(0, 8)}...`);
    console.log(`   Entry Price: ${entryPrice.toExponential(4)} SOL`);
    console.log(`   Liquidation Price: ${liquidationPrice.toExponential(4)} SOL`);
    console.log(`   Current Price: ${monitor.lastPrice > 0 ? monitor.lastPrice.toExponential(4) : 'pending...'} SOL`);
    
    if (monitor.lastPrice > 0) {
      const buffer = ((monitor.lastPrice - liquidationPrice) / liquidationPrice) * 100;
      console.log(`   Buffer: ${buffer.toFixed(2)}% above liquidation`);
      
      // Check immediately if already below threshold
      if (monitor.lastPrice <= liquidationPrice) {
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