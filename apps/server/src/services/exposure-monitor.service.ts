import { PublicKey } from '@solana/web3.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';

// Warning threshold: 5% of pool liquidity
const EXPOSURE_WARNING_THRESHOLD_BPS = 500; // 5%
// Critical threshold: 10% of pool liquidity  
const EXPOSURE_CRITICAL_THRESHOLD_BPS = 1000; // 10%

export interface TokenExposure {
  tokenMint: string;
  tokenSymbol: string;
  activeLoans: number;
  totalCollateralAmount: bigint;
  totalSolLent: bigint;
  poolLiquidity: bigint;
  exposureBps: number;
  lastUpdated: number;
  warningLevel: 'none' | 'warning' | 'critical';
}

// In-memory exposure cache
const exposureCache: Map<string, TokenExposure> = new Map();

// Track last alert time to avoid spam
const lastAlertTime: Map<string, number> = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Update exposure for a token after a new loan
 */
export async function recordLoanExposure(
  tokenMint: string,
  tokenSymbol: string,
  collateralAmount: bigint,
  solLent: bigint
): Promise<{ warning: boolean; exposureBps: number }> {
  const cached = exposureCache.get(tokenMint) || createEmptyExposure(tokenMint, tokenSymbol);

  cached.activeLoans += 1;
  cached.totalCollateralAmount += collateralAmount;
  cached.totalSolLent += solLent;
  cached.lastUpdated = Date.now();

  exposureCache.set(tokenMint, cached);

  return checkAndAlertExposure(cached);
}

/**
 * Update exposure after loan repayment
 */
export function recordRepayment(
  tokenMint: string,
  collateralReturned: bigint,
  solRepaid: bigint
): void {
  const cached = exposureCache.get(tokenMint);
  if (!cached) return;

  cached.activeLoans = Math.max(0, cached.activeLoans - 1);
  cached.totalCollateralAmount = cached.totalCollateralAmount > collateralReturned
    ? cached.totalCollateralAmount - collateralReturned
    : 0n;
  cached.totalSolLent = cached.totalSolLent > solRepaid
    ? cached.totalSolLent - solRepaid
    : 0n;
  cached.lastUpdated = Date.now();

  // Recalculate exposure
  if (cached.poolLiquidity > 0n) {
    cached.exposureBps = Number(cached.totalSolLent * 10000n / cached.poolLiquidity);
  }
  cached.warningLevel = getWarningLevel(cached.exposureBps);
}

/**
 * Update pool liquidity for a token
 */
export async function updatePoolLiquidity(
  tokenMint: string,
  tokenSymbol: string,
  poolLiquidity: bigint
): Promise<void> {
  const cached = exposureCache.get(tokenMint) || createEmptyExposure(tokenMint, tokenSymbol);

  cached.poolLiquidity = poolLiquidity;
  cached.lastUpdated = Date.now();

  if (poolLiquidity > 0n) {
    cached.exposureBps = Number(cached.totalSolLent * 10000n / poolLiquidity);
  }
  cached.warningLevel = getWarningLevel(cached.exposureBps);

  exposureCache.set(tokenMint, cached);

  await checkAndAlertExposure(cached);
}

/**
 * Full refresh of exposure data from database
 */
export async function refreshAllExposures(): Promise<void> {
  try {
    const loansByToken = await prisma.loan.groupBy({
      by: ['tokenMint'],
      where: { status: 'Active' },
      _count: { tokenMint: true },
    });

    for (const group of loansByToken) {
      const token = await prisma.token.findUnique({
        where: { id: group.tokenMint },
      });

      if (!token) continue;
      
      // Get detailed loan data for sums since we can't use groupBy on string fields
      const loans = await prisma.loan.findMany({
        where: { tokenMint: group.tokenMint, status: 'Active' },
        select: { collateralAmount: true, solBorrowed: true },
      });

      const totalCollateralAmount = loans.reduce((sum, loan) => sum + BigInt(loan.collateralAmount), 0n);
      const totalSolLent = loans.reduce((sum, loan) => sum + BigInt(loan.solBorrowed), 0n);

      const cached = exposureCache.get(group.tokenMint) || createEmptyExposure(group.tokenMint, token.symbol);

      cached.activeLoans = group._count.tokenMint || 0;
      cached.totalCollateralAmount = totalCollateralAmount;
      cached.totalSolLent = totalSolLent;
      cached.tokenSymbol = token.symbol;
      cached.lastUpdated = Date.now();

      if (token.poolLiquidity) {
        cached.poolLiquidity = BigInt(token.poolLiquidity);
        cached.exposureBps = Number(cached.totalSolLent * 10000n / cached.poolLiquidity);
      }

      cached.warningLevel = getWarningLevel(cached.exposureBps);
      exposureCache.set(group.tokenMint, cached);
    }

    console.log(`[ExposureMonitor] Refreshed exposure for ${loansByToken.length} tokens`);
  } catch (error: any) {
    console.error('[ExposureMonitor] Failed to refresh exposures:', error.message);
  }
}

async function checkAndAlertExposure(exposure: TokenExposure): Promise<{ warning: boolean; exposureBps: number }> {
  const warningLevel = getWarningLevel(exposure.exposureBps);
  exposure.warningLevel = warningLevel;

  if (warningLevel === 'none') {
    return { warning: false, exposureBps: exposure.exposureBps };
  }

  const lastAlert = lastAlertTime.get(exposure.tokenMint) || 0;
  if (Date.now() - lastAlert < ALERT_COOLDOWN_MS) {
    return { warning: true, exposureBps: exposure.exposureBps };
  }

  await securityMonitor.log({
    severity: warningLevel === 'critical' ? 'CRITICAL' : 'HIGH',
    category: 'Loans',
    eventType: warningLevel === 'critical'
      ? SECURITY_EVENT_TYPES.EXPOSURE_CRITICAL
      : SECURITY_EVENT_TYPES.EXPOSURE_WARNING,
    message: `Token exposure ${warningLevel.toUpperCase()}: ${exposure.tokenSymbol} at ${(exposure.exposureBps / 100).toFixed(2)}% of pool`,
    details: {
      tokenMint: exposure.tokenMint,
      tokenSymbol: exposure.tokenSymbol,
      activeLoans: exposure.activeLoans,
      totalSolLent: Number(exposure.totalSolLent) / 1e9,
      poolLiquidity: Number(exposure.poolLiquidity) / 1e9,
      exposurePct: exposure.exposureBps / 100,
      warningThreshold: EXPOSURE_WARNING_THRESHOLD_BPS / 100,
      criticalThreshold: EXPOSURE_CRITICAL_THRESHOLD_BPS / 100,
    },
    source: 'exposure-monitor',
  });

  lastAlertTime.set(exposure.tokenMint, Date.now());

  return { warning: true, exposureBps: exposure.exposureBps };
}

function getWarningLevel(exposureBps: number): 'none' | 'warning' | 'critical' {
  if (exposureBps >= EXPOSURE_CRITICAL_THRESHOLD_BPS) return 'critical';
  if (exposureBps >= EXPOSURE_WARNING_THRESHOLD_BPS) return 'warning';
  return 'none';
}

function createEmptyExposure(tokenMint: string, tokenSymbol: string): TokenExposure {
  return {
    tokenMint,
    tokenSymbol,
    activeLoans: 0,
    totalCollateralAmount: 0n,
    totalSolLent: 0n,
    poolLiquidity: 0n,
    exposureBps: 0,
    lastUpdated: Date.now(),
    warningLevel: 'none',
  };
}

export function getAllExposures(): TokenExposure[] {
  return Array.from(exposureCache.values()).sort((a, b) => b.exposureBps - a.exposureBps);
}

export function getTokenExposure(tokenMint: string): TokenExposure | undefined {
  return exposureCache.get(tokenMint);
}

export function getTokensWithWarnings(): TokenExposure[] {
  return Array.from(exposureCache.values())
    .filter(e => e.warningLevel !== 'none')
    .sort((a, b) => b.exposureBps - a.exposureBps);
}