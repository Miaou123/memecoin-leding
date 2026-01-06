import { lpLimitsService } from '../services/lp-limits.service.js';
import { programMonitor } from '../services/program-monitor.service.js';
import { prisma } from '../db/client.js';
import { config } from 'dotenv';

// Load environment variables
config();

async function testMonitoring() {
  console.log('🔍 Testing Monitoring Services\n');
  console.log('================================================\n');
  
  // 1. Test LP monitoring
  console.log('📊 LP Limits Monitoring\n');
  
  try {
    // Get all tokens with active loans
    const activeTokens = await prisma.loan.groupBy({
      by: ['tokenMint'],
      where: { status: 'active' },
      _count: { tokenMint: true },
    });
    
    console.log(`Found ${activeTokens.length} tokens with active loans\n`);
    
    for (const { tokenMint, _count } of activeTokens) {
      const token = await prisma.token.findUnique({
        where: { id: tokenMint },
        select: { symbol: true, name: true },
      });
      
      const usage = await lpLimitsService.getTokenLPUsage(tokenMint);
      
      if (usage) {
        const icon = usage.usagePercent >= usage.maxPercent * 0.8 ? '⚠️ ' : '✅';
        console.log(`${icon} ${token?.symbol || 'Unknown'} (${tokenMint.substring(0, 8)}...)`);
        console.log(`   Active Loans: ${_count.tokenMint}`);
        console.log(`   LP Value: $${usage.lpValueUSD.toLocaleString()}`);
        console.log(`   Usage: ${usage.usagePercent.toFixed(2)}% / ${usage.maxPercent}%`);
        console.log(`   Status: ${usage.usagePercent >= usage.maxPercent * 0.8 ? 'WARNING - Approaching limit!' : 'OK'}`);
        console.log('');
      }
    }
    
    // Run the monitoring job
    console.log('🔄 Running LP monitoring job...\n');
    await lpLimitsService.monitorLPLimits();
    console.log('✅ LP monitoring job completed\n');
    
  } catch (error: any) {
    console.error('❌ LP monitoring test failed:', error.message);
  }
  
  // 2. Test program monitoring
  console.log('\n================================================\n');
  console.log('📡 Program Access Monitoring\n');
  
  const stats = programMonitor.getStats();
  console.log(`Status: ${stats.isMonitoring ? '✅ Active' : '❌ Inactive'}`);
  console.log(`Program ID: ${stats.programId}`);
  console.log(`Backend Transactions Tracked: ${stats.trackedTransactions}`);
  
  if (!stats.isMonitoring) {
    console.log('\n⚠️  Starting program monitor...');
    await programMonitor.startMonitoring();
    console.log('✅ Program monitor started');
  }
  
  // 3. Recent security events
  console.log('\n================================================\n');
  console.log('🚨 Recent Security Events\n');
  
  try {
    const recentEvents = await prisma.securityEvent.findMany({
      where: {
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });
    
    if (recentEvents.length === 0) {
      console.log('No security events in the last 24 hours');
    } else {
      for (const event of recentEvents) {
        const icon = 
          event.severity === 'CRITICAL' ? '🔴' :
          event.severity === 'HIGH' ? '🟠' :
          event.severity === 'MEDIUM' ? '🟡' :
          '🟢';
          
        console.log(`${icon} [${event.severity}] ${event.eventType}`);
        console.log(`   ${event.message}`);
        console.log(`   Time: ${new Date(event.timestamp).toLocaleString()}`);
        console.log('');
      }
    }
  } catch (error: any) {
    console.error('Could not fetch security events:', error.message);
  }
  
  console.log('\n================================================');
  console.log('✅ Monitoring Test Complete\n');
  
  process.exit(0);
}

// Run test
testMonitoring().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});