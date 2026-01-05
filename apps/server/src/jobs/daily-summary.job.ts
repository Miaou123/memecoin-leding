import { Job } from 'bullmq';
import { prisma } from '../db/client.js';
import { securityMonitor } from '../services/security-monitor.service.js';
import { getAllExposures } from '../services/exposure-monitor.service.js';
import { getCircuitBreakerStatus } from '../services/circuit-breaker.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

export async function dailySummaryJob(job: Job) {
  console.log('📊 Generating daily summary...');
  
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get loan stats
    const [
      totalActiveLoans,
      loansCreatedToday,
      loansRepaidToday,
      loansLiquidatedToday,
    ] = await Promise.all([
      prisma.loan.count({ where: { status: 'Active' } }),
      prisma.loan.count({ where: { createdAt: { gte: yesterday } } }),
      prisma.loan.count({ where: { status: 'Repaid', repaidAt: { gte: yesterday } } }),
      prisma.loan.count({ where: { status: { startsWith: 'Liquidated' }, liquidatedAt: { gte: yesterday } } }),
    ]);
    
    // Get liquidation losses
    const liquidations = await prisma.liquidationResult.findMany({
      where: { liquidatedAt: { gte: yesterday } },
      select: {
        lossLamports: true,
        lossBps: true,
        autoBlacklisted: true,
      },
    });
    
    const totalLossLamports = liquidations.reduce(
      (sum, l) => sum + BigInt(l.lossLamports || '0'),
      0n
    );
    const autoBlacklistedCount = liquidations.filter(l => l.autoBlacklisted).length;
    const avgLossBps = liquidations.length > 0
      ? liquidations.reduce((sum, l) => sum + l.lossBps, 0) / liquidations.length
      : 0;
    
    // Get SOL volume
    const solLentLoans = await prisma.loan.findMany({
      where: { createdAt: { gte: yesterday } },
      select: { solBorrowed: true },
    });
    
    const solRepaidLoans = await prisma.loan.findMany({
      where: { status: 'Repaid', repaidAt: { gte: yesterday } },
      select: { solBorrowed: true },
    });
    
    const solLent = solLentLoans.reduce((sum, loan) => sum + BigInt(loan.solBorrowed), 0n);
    const solRepaid = solRepaidLoans.reduce((sum, loan) => sum + BigInt(loan.solBorrowed), 0n);
    
    // Get exposure warnings
    const exposures = getAllExposures();
    const warningCount = exposures.filter(e => e.warningLevel !== 'none').length;
    
    // Get circuit breaker status
    const cbStatus = await getCircuitBreakerStatus();
    
    // Get security events
    const securityEvents = await prisma.securityEvent.count({
      where: {
        timestamp: { gte: yesterday },
        severity: { in: ['HIGH', 'CRITICAL'] },
      },
    });
    
    // Build summary message
    const summary = {
      date: now.toISOString().split('T')[0],
      loans: {
        active: totalActiveLoans,
        created: loansCreatedToday,
        repaid: loansRepaidToday,
        liquidated: loansLiquidatedToday,
      },
      volume: {
        solLent: Number(solLent) / 1e9,
        solRepaid: Number(solRepaid) / 1e9,
      },
      liquidations: {
        count: liquidations.length,
        totalLossSol: Number(totalLossLamports) / 1e9,
        avgLossPct: avgLossBps / 100,
        autoBlacklisted: autoBlacklistedCount,
      },
      exposure: {
        tokensTracked: exposures.length,
        warnings: warningCount,
      },
      circuitBreaker: {
        isTripped: cbStatus.isTripped,
        reason: cbStatus.reason,
      },
      security: {
        highCriticalEvents: securityEvents,
      },
    };
    
    // Send via security monitor (Telegram)
    await securityMonitor.log({
      severity: 'LOW',
      category: 'Admin',
      eventType: SECURITY_EVENT_TYPES.DAILY_SUMMARY,
      message: formatDailySummary(summary),
      details: summary,
      source: 'daily-summary-job',
    });
    
    console.log('✅ Daily summary sent');
    return summary;
    
  } catch (error: any) {
    console.error('❌ Daily summary failed:', error.message);
    throw error;
  }
}

function formatDailySummary(summary: any): string {
  return `📈 DAILY SUMMARY - ${summary.date}

📊 Loans:
- Active: ${summary.loans.active}
- Created: ${summary.loans.created}
- Repaid: ${summary.loans.repaid}
- Liquidated: ${summary.loans.liquidated}

💰 Volume:
- SOL Lent: ${summary.volume.solLent.toFixed(2)} SOL
- SOL Repaid: ${summary.volume.solRepaid.toFixed(2)} SOL

⚠️ Liquidations:
- Count: ${summary.liquidations.count}
- Total Loss: ${summary.liquidations.totalLossSol.toFixed(4)} SOL
- Avg Loss: ${summary.liquidations.avgLossPct.toFixed(2)}%
- Auto-blacklisted: ${summary.liquidations.autoBlacklisted}

🎯 Exposure:
- Tokens tracked: ${summary.exposure.tokensTracked}
- Warnings: ${summary.exposure.warnings}

⚡ Circuit Breaker: ${summary.circuitBreaker.isTripped ? '🔴 TRIPPED' : '🟢 OK'}
${summary.circuitBreaker.reason ? `   Reason: ${summary.circuitBreaker.reason}` : ''}

🔒 Security Events (HIGH/CRITICAL): ${summary.security.highCriticalEvents}`;
}