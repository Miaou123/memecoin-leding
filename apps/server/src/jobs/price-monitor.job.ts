import { Job } from 'bullmq';
import { priceService } from '../services/price.service.js';
import { websocketService } from '../websocket/index.js';

export async function priceMonitorJob(job: Job) {
  const jobName = job.name;
  
  try {
    if (jobName === 'update-prices') {
      console.log('📈 Updating token prices...');
      
      await priceService.updateAllPrices();
      
      // Emit price updates via WebSocket
      // In a real implementation, you'd track which prices changed
      websocketService.broadcast('price:update', {
        timestamp: Date.now(),
        message: 'Prices updated',
      });
      
      console.log('✅ Price update completed');
      
      return { status: 'prices_updated' };
      
    } else if (jobName === 'check-price-alerts') {
      console.log('🚨 Checking price alerts...');
      
      await priceService.checkPriceAlerts();
      
      console.log('✅ Price alerts check completed');
      
      return { status: 'price_alerts_checked' };
    }
    
  } catch (error) {
    console.error(`❌ Price monitor job (${jobName}) failed:`, error);
    throw error;
  }
}