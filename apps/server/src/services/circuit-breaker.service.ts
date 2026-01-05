import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';

// Circuit breaker thresholds
const LOSS_THRESHOLD_24H_LAMPORTS = 10_000_000_000n; // 10 SOL in 24h
const LOSS_THRESHOLD_1H_LAMPORTS = 5_000_000_000n;   // 5 SOL in 1h
const LIQUIDATION_COUNT_THRESHOLD_1H = 10;           // 10 liquidations in 1h

interface CircuitBreakerStatus {
  isTripped: boolean;
  reason?: string;
  trippedAt?: Date;
  metrics: {
    loss24h: bigint;
    loss1h: bigint;
    liquidationCount1h: number;
  };
}

let circuitBreakerTripped = false;
let tripReason: string | undefined;
let trippedAt: Date | undefined;

/**
 * Check if circuit breaker is tripped
 */
export function isCircuitBreakerTripped(): boolean {
  return circuitBreakerTripped;
}

/**
 * Get circuit breaker status
 */
export async function getCircuitBreakerStatus(): Promise<CircuitBreakerStatus> {
  const metrics = await calculateMetrics();
  
  return {
    isTripped: circuitBreakerTripped,
    reason: tripReason,
    trippedAt,
    metrics,
  };
}

/**
 * Calculate current metrics
 */
async function calculateMetrics(): Promise<{
  loss24h: bigint;
  loss1h: bigint;
  liquidationCount1h: number;
}> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  try {
    // Get liquidations in last 24h
    const liquidations24h = await prisma.liquidationResult.findMany({
      where: {
        liquidatedAt: { gte: twentyFourHoursAgo },
      },
      select: {
        lossLamports: true,
        liquidatedAt: true,
      },
    });
    
    let loss24h = 0n;
    let loss1h = 0n;
    let liquidationCount1h = 0;
    
    for (const liq of liquidations24h) {
      const lossLamports = BigInt(liq.lossLamports || '0');
      loss24h += lossLamports;
      
      if (liq.liquidatedAt >= oneHourAgo) {
        loss1h += lossLamports;
        liquidationCount1h++;
      }
    }
    
    return { loss24h, loss1h, liquidationCount1h };
  } catch (error: any) {
    console.error('[CircuitBreaker] Failed to calculate metrics:', error.message);
    return { loss24h: 0n, loss1h: 0n, liquidationCount1h: 0 };
  }
}

/**
 * Check thresholds and trip circuit breaker if needed
 */
export async function checkAndTripCircuitBreaker(): Promise<boolean> {
  if (circuitBreakerTripped) {
    return true; // Already tripped
  }
  
  const metrics = await calculateMetrics();
  
  let shouldTrip = false;
  let reason = '';
  
  // Check 24h loss threshold
  if (metrics.loss24h >= LOSS_THRESHOLD_24H_LAMPORTS) {
    shouldTrip = true;
    reason = `24h loss threshold exceeded: ${Number(metrics.loss24h) / 1e9} SOL >= ${Number(LOSS_THRESHOLD_24H_LAMPORTS) / 1e9} SOL`;
  }
  
  // Check 1h loss threshold
  if (metrics.loss1h >= LOSS_THRESHOLD_1H_LAMPORTS) {
    shouldTrip = true;
    reason = `1h loss threshold exceeded: ${Number(metrics.loss1h) / 1e9} SOL >= ${Number(LOSS_THRESHOLD_1H_LAMPORTS) / 1e9} SOL`;
  }
  
  // Check liquidation count
  if (metrics.liquidationCount1h >= LIQUIDATION_COUNT_THRESHOLD_1H) {
    shouldTrip = true;
    reason = `Liquidation count threshold exceeded: ${metrics.liquidationCount1h} >= ${LIQUIDATION_COUNT_THRESHOLD_1H} in 1h`;
  }
  
  if (shouldTrip) {
    await tripCircuitBreaker(reason, metrics);
  }
  
  return shouldTrip;
}

/**
 * Trip the circuit breaker
 */
async function tripCircuitBreaker(
  reason: string,
  metrics: { loss24h: bigint; loss1h: bigint; liquidationCount1h: number }
): Promise<void> {
  circuitBreakerTripped = true;
  tripReason = reason;
  trippedAt = new Date();
  
  console.error(`🚨 CIRCUIT BREAKER TRIPPED: ${reason}`);
  
  await securityMonitor.log({
    severity: 'CRITICAL',
    category: 'Protocol',
    eventType: 'CIRCUIT_BREAKER_TRIPPED',
    message: `⚡ CIRCUIT BREAKER TRIPPED: ${reason}`,
    details: {
      reason,
      loss24hSol: Number(metrics.loss24h) / 1e9,
      loss1hSol: Number(metrics.loss1h) / 1e9,
      liquidationCount1h: metrics.liquidationCount1h,
      thresholds: {
        loss24hSol: Number(LOSS_THRESHOLD_24H_LAMPORTS) / 1e9,
        loss1hSol: Number(LOSS_THRESHOLD_1H_LAMPORTS) / 1e9,
        liquidationCount1h: LIQUIDATION_COUNT_THRESHOLD_1H,
      },
      action: 'NEW LOANS BLOCKED - Manual reset required',
    },
    source: 'circuit-breaker',
  });
}

/**
 * Reset circuit breaker (admin only)
 */
export async function resetCircuitBreaker(adminId: string): Promise<void> {
  const wasTripped = circuitBreakerTripped;
  
  circuitBreakerTripped = false;
  tripReason = undefined;
  trippedAt = undefined;
  
  if (wasTripped) {
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Admin',
      eventType: 'CIRCUIT_BREAKER_RESET',
      message: 'Circuit breaker manually reset by admin',
      details: {
        adminId,
        previousReason: tripReason,
      },
      source: 'circuit-breaker',
    });
  }
  
  console.log(`✅ Circuit breaker reset by admin ${adminId}`);
}

/**
 * Check circuit breaker before allowing new loans
 * Throws error if tripped
 */
export async function assertCircuitBreakerOk(): Promise<void> {
  // Also check thresholds in case metrics changed
  await checkAndTripCircuitBreaker();
  
  if (circuitBreakerTripped) {
    throw new Error(`Protocol paused: ${tripReason}`);
  }
}