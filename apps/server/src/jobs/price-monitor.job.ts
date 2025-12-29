import { Job } from 'bullmq';
import { WebSocketEvent, PriceData } from '@memecoin-lending/types';
import { priceService, ExtendedPriceData } from '../services/price.js';
import { websocketService } from '../websocket/index.js';
import { getAllTokenDefinitions } from '@memecoin-lending/config';

export async function priceMonitorJob(job: Job) {
  const jobName = job.name;
  
  try {
    if (jobName === 'update-prices') {
      console.log('📈 Updating token prices...');
      
      // Get all whitelisted token mints
      const tokenDefinitions = getAllTokenDefinitions();
      const mints = tokenDefinitions.map(token => token.mint);
      
      // Add SOL to the list if not already present
      const solMint = 'So11111111111111111111111111111111111111112';
      if (!mints.includes(solMint)) {
        mints.push(solMint);
      }
      
      // Fetch latest prices
      const prices = await priceService.getPrices(mints);
      
      // Convert to array for WebSocket broadcast
      const priceUpdates = Array.from(prices.values()).map(priceData => {
        const price = priceData as ExtendedPriceData;
        return {
          mint: price.mint,
          usdPrice: price.usdPrice,
          solPrice: price.solPrice,
          priceChange24h: price.priceChange24h,
          source: price.source,
          timestamp: price.timestamp,
        };
      });
      
      // Emit price updates via WebSocket
      websocketService.broadcast(WebSocketEvent.PRICE_UPDATE, {
        prices: priceUpdates,
        timestamp: Date.now(),
        message: `Updated ${prices.size} token prices`,
      });
      
      console.log(`✅ Price update completed: ${prices.size}/${mints.length} tokens`);
      
      return { 
        status: 'prices_updated',
        updated: prices.size,
        total: mints.length,
        prices: priceUpdates
      };
      
    } else if (jobName === 'check-price-alerts') {
      console.log('🚨 Checking price alerts...');
      
      // In a real implementation, this would:
      // 1. Check for loans that might be approaching liquidation
      // 2. Alert users about price movements
      // 3. Trigger liquidation processes if needed
      
      console.log('✅ Price alerts check completed');
      
      return { status: 'price_alerts_checked' };
      
    } else if (jobName === 'clear-price-cache') {
      console.log('🧹 Clearing price cache...');
      
      priceService.clearCache();
      
      console.log('✅ Price cache cleared');
      
      return { status: 'price_cache_cleared' };
    }
    
  } catch (error) {
    console.error(`❌ Price monitor job (${jobName}) failed:`, error);
    throw error;
  }
}