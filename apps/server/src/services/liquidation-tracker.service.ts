import { PublicKey } from '@solana/web3.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getConnection, getProgram } from './solana.service.js';
import { getAdminKeypair } from '../config/keys.js';
import { prisma } from '../db/client.js';

// Threshold for auto-blacklist (10% loss)
const AUTO_BLACKLIST_THRESHOLD_BPS = 1000; // 10%

export interface LiquidationResult {
  loanId: string;
  loanPda: string;
  tokenMint: string;
  tokenSymbol: string;
  expectedSolRecovery: bigint;
  actualSolRecovery: bigint;
  lossBps: number;
  timestamp: number;
  autoBlacklisted: boolean;
  txSignature?: string;
}

// In-memory store
const liquidationHistory: LiquidationResult[] = [];

/**
 * Record a liquidation result and check if token should be blacklisted
 */
export async function recordLiquidationResult(
  loanId: string,
  loanPda: string,
  tokenMint: string,
  tokenSymbol: string,
  expectedSolRecovery: bigint,
  actualSolRecovery: bigint,
  txSignature?: string
): Promise<{ blacklisted: boolean; lossBps: number }> {
  // Calculate loss in basis points
  let lossBps = 0;
  if (expectedSolRecovery > 0n) {
    if (actualSolRecovery < expectedSolRecovery) {
      lossBps = Number((expectedSolRecovery - actualSolRecovery) * 10000n / expectedSolRecovery);
    }
  }

  const shouldBlacklist = lossBps > AUTO_BLACKLIST_THRESHOLD_BPS;

  const result: LiquidationResult = {
    loanId,
    loanPda,
    tokenMint,
    tokenSymbol,
    expectedSolRecovery,
    actualSolRecovery,
    lossBps,
    timestamp: Date.now(),
    autoBlacklisted: shouldBlacklist,
    txSignature,
  };

  // Store in memory
  liquidationHistory.unshift(result);
  if (liquidationHistory.length > 1000) {
    liquidationHistory.pop();
  }

  // Persist to database
  try {
    // Get borrower and collateral amount from loan record
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { borrower: true, collateralAmount: true },
    });
    
    await prisma.liquidationResult.create({
      data: {
        loanId,
        tokenMint,
        tokenSymbol,
        borrower: loan?.borrower || 'unknown',
        collateralAmount: loan?.collateralAmount || '0',
        expectedSolRecovery: expectedSolRecovery.toString(),
        actualSolRecovery: actualSolRecovery.toString(),
        lossLamports: (expectedSolRecovery - actualSolRecovery).toString(),
        lossBps,
        autoBlacklisted: shouldBlacklist,
        txSignature,
      },
    });
  } catch (error: any) {
    console.error('[LiquidationTracker] Failed to persist result:', error.message);
  }

  // Send alert via existing security monitor
  if (lossBps > 0) {
    await securityMonitor.log({
      severity: shouldBlacklist ? 'CRITICAL' : 'HIGH',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_LOSS_DETECTED,
      message: `Liquidation loss ${(lossBps / 100).toFixed(2)}% on ${tokenSymbol}${shouldBlacklist ? ' - AUTO-BLACKLISTING' : ''}`,
      details: {
        loanId,
        loanPda,
        tokenMint,
        tokenSymbol,
        expectedSol: Number(expectedSolRecovery) / 1e9,
        actualSol: Number(actualSolRecovery) / 1e9,
        lossPct: lossBps / 100,
        lossLamports: Number(expectedSolRecovery - actualSolRecovery),
        threshold: AUTO_BLACKLIST_THRESHOLD_BPS / 100,
        autoBlacklisted: shouldBlacklist,
      },
      source: 'liquidation-tracker',
      txSignature,
    });
  } else {
    await securityMonitor.log({
      severity: 'LOW',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_RECOVERY_SUCCESS,
      message: `Liquidation successful for ${tokenSymbol} - full recovery`,
      details: {
        loanId,
        tokenMint,
        tokenSymbol,
        recoveredSol: Number(actualSolRecovery) / 1e9,
      },
      source: 'liquidation-tracker',
      txSignature,
    });
  }

  // Auto-blacklist if threshold exceeded
  if (shouldBlacklist) {
    await autoBlacklistToken(
      tokenMint,
      tokenSymbol,
      `Liquidation loss ${(lossBps / 100).toFixed(2)}% exceeded ${AUTO_BLACKLIST_THRESHOLD_BPS / 100}% threshold`
    );
  }

  return { blacklisted: shouldBlacklist, lossBps };
}

/**
 * Blacklist a token on-chain via admin instruction
 */
async function autoBlacklistToken(
  tokenMint: string,
  tokenSymbol: string,
  reason: string
): Promise<boolean> {
  try {
    const program = getProgram();
    const admin = getAdminKeypair();

    const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');
    const TOKEN_CONFIG_SEED = Buffer.from('token_config');

    const [protocolStatePda] = PublicKey.findProgramAddressSync(
      [PROTOCOL_STATE_SEED],
      program.programId
    );

    const [tokenConfigPda] = PublicKey.findProgramAddressSync(
      [TOKEN_CONFIG_SEED, new PublicKey(tokenMint).toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .blacklistToken()
      .accounts({
        protocolState: protocolStatePda,
        tokenConfig: tokenConfigPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log(`[LiquidationTracker] Token ${tokenMint} auto-blacklisted. TX: ${tx}`);

    await securityMonitor.log({
      severity: 'CRITICAL',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.TOKEN_AUTO_BLACKLISTED,
      message: `Token ${tokenSymbol} auto-blacklisted due to liquidation losses`,
      details: {
        tokenMint,
        tokenSymbol,
        reason,
      },
      source: 'liquidation-tracker',
      txSignature: tx,
    });

    // Update database
    await prisma.token.updateMany({
      where: { id: tokenMint },
      data: { blacklisted: true, blacklistReason: reason },
    });

    return true;
  } catch (error: any) {
    console.error(`[LiquidationTracker] Failed to blacklist ${tokenMint}:`, error.message);

    await securityMonitor.log({
      severity: 'CRITICAL',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.TOKEN_BLACKLIST_FAILED,
      message: `Failed to auto-blacklist ${tokenSymbol}: ${error.message}`,
      details: {
        tokenMint,
        tokenSymbol,
        error: error.message,
      },
      source: 'liquidation-tracker',
    });

    return false;
  }
}

/**
 * Get liquidation stats for a token
 */
export function getTokenLiquidationStats(tokenMint: string): {
  totalLiquidations: number;
  totalLossLamports: bigint;
  avgLossBps: number;
  lastLiquidation?: LiquidationResult;
} {
  const tokenLiquidations = liquidationHistory.filter(l => l.tokenMint === tokenMint);

  if (tokenLiquidations.length === 0) {
    return { totalLiquidations: 0, totalLossLamports: 0n, avgLossBps: 0 };
  }

  const totalLossLamports = tokenLiquidations.reduce((sum, l) => {
    if (l.actualSolRecovery < l.expectedSolRecovery) {
      return sum + (l.expectedSolRecovery - l.actualSolRecovery);
    }
    return sum;
  }, 0n);

  const avgLossBps = tokenLiquidations.reduce((sum, l) => sum + l.lossBps, 0) / tokenLiquidations.length;

  return {
    totalLiquidations: tokenLiquidations.length,
    totalLossLamports,
    avgLossBps,
    lastLiquidation: tokenLiquidations[0],
  };
}

/**
 * Get recent liquidation history
 */
export function getRecentLiquidations(limit: number = 20): LiquidationResult[] {
  return liquidationHistory.slice(0, limit);
}

/**
 * Get all liquidations with losses
 */
export function getLiquidationsWithLosses(): LiquidationResult[] {
  return liquidationHistory.filter(l => l.lossBps > 0);
}