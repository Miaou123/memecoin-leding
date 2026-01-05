import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { getConnection } from './solana.service.js';

// Thresholds
const LOW_BALANCE_THRESHOLD_SOL = 10;      // Alert when treasury < 10 SOL
const CRITICAL_BALANCE_THRESHOLD_SOL = 2;  // Critical alert when < 2 SOL
const LARGE_WITHDRAWAL_THRESHOLD_SOL = 5;  // Alert on withdrawals > 5 SOL
const CHECK_INTERVAL_MS = 60_000;          // Check every 60 seconds

interface TreasurySnapshot {
  balance: bigint;
  timestamp: number;
}

class TreasuryHealthService {
  private treasuryPda: PublicKey | null = null;
  private lastSnapshot: TreasurySnapshot | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastAlertTime: Map<string, number> = new Map();
  private alertCooldownMs = 15 * 60 * 1000; // 15 min cooldown
  
  /**
   * Initialize treasury monitoring
   */
  async initialize(treasuryPdaAddress: string): Promise<void> {
    try {
      this.treasuryPda = new PublicKey(treasuryPdaAddress);
      
      // Get initial snapshot
      await this.takeSnapshot();
      
      // Start periodic checks
      this.checkInterval = setInterval(() => {
        this.checkHealth().catch(err => {
          console.error('[TreasuryHealth] Check failed:', err.message);
        });
      }, CHECK_INTERVAL_MS);
      
      console.log(`[TreasuryHealth] Monitoring treasury: ${treasuryPdaAddress}`);
      console.log(`[TreasuryHealth] Initial balance: ${this.getBalanceSol().toFixed(4)} SOL`);
      
    } catch (error: any) {
      console.error('[TreasuryHealth] Failed to initialize:', error.message);
      throw error;
    }
  }
  
  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  /**
   * Take a balance snapshot
   */
  private async takeSnapshot(): Promise<TreasurySnapshot> {
    if (!this.treasuryPda) {
      throw new Error('Treasury PDA not initialized');
    }
    
    const connection = getConnection();
    const balance = await connection.getBalance(this.treasuryPda);
    
    const snapshot: TreasurySnapshot = {
      balance: BigInt(balance),
      timestamp: Date.now(),
    };
    
    this.lastSnapshot = snapshot;
    return snapshot;
  }
  
  /**
   * Check treasury health
   */
  async checkHealth(): Promise<void> {
    if (!this.treasuryPda) return;
    
    const previousSnapshot = this.lastSnapshot;
    const currentSnapshot = await this.takeSnapshot();
    
    const balanceSol = Number(currentSnapshot.balance) / LAMPORTS_PER_SOL;
    
    // Check low balance
    if (balanceSol < CRITICAL_BALANCE_THRESHOLD_SOL) {
      await this.alert('CRITICAL_BALANCE', {
        severity: 'CRITICAL',
        message: `🚨 CRITICAL: Treasury balance critically low: ${balanceSol.toFixed(4)} SOL`,
        balanceSol,
        threshold: CRITICAL_BALANCE_THRESHOLD_SOL,
      });
    } else if (balanceSol < LOW_BALANCE_THRESHOLD_SOL) {
      await this.alert('LOW_BALANCE', {
        severity: 'HIGH',
        message: `⚠️ Treasury balance low: ${balanceSol.toFixed(4)} SOL`,
        balanceSol,
        threshold: LOW_BALANCE_THRESHOLD_SOL,
      });
    }
    
    // Check for large withdrawals
    if (previousSnapshot) {
      const balanceChange = previousSnapshot.balance - currentSnapshot.balance;
      const changeInSol = Number(balanceChange) / LAMPORTS_PER_SOL;
      
      if (changeInSol >= LARGE_WITHDRAWAL_THRESHOLD_SOL) {
        await this.alert('LARGE_WITHDRAWAL', {
          severity: 'HIGH',
          message: `🔔 Large treasury withdrawal detected: ${changeInSol.toFixed(4)} SOL`,
          withdrawalSol: changeInSol,
          previousBalance: Number(previousSnapshot.balance) / LAMPORTS_PER_SOL,
          currentBalance: balanceSol,
          timeDeltaMs: currentSnapshot.timestamp - previousSnapshot.timestamp,
        });
      }
    }
  }
  
  /**
   * Send alert with cooldown
   */
  private async alert(
    alertType: string,
    data: { severity: 'HIGH' | 'CRITICAL'; message: string; [key: string]: any }
  ): Promise<void> {
    const lastAlert = this.lastAlertTime.get(alertType) || 0;
    if (Date.now() - lastAlert < this.alertCooldownMs) {
      return; // Still in cooldown
    }
    
    this.lastAlertTime.set(alertType, Date.now());
    
    await securityMonitor.log({
      severity: data.severity,
      category: 'Treasury',
      eventType: `TREASURY_${alertType}`,
      message: data.message,
      details: data,
      source: 'treasury-health',
    });
  }
  
  /**
   * Get current balance in SOL
   */
  getBalanceSol(): number {
    if (!this.lastSnapshot) return 0;
    return Number(this.lastSnapshot.balance) / LAMPORTS_PER_SOL;
  }
  
  /**
   * Get current balance in lamports
   */
  getBalanceLamports(): bigint {
    return this.lastSnapshot?.balance || 0n;
  }
  
  /**
   * Get full status
   */
  getStatus(): {
    initialized: boolean;
    treasuryPda: string | null;
    balanceSol: number;
    balanceLamports: string;
    lastCheck: number | null;
    healthStatus: 'healthy' | 'low' | 'critical' | 'unknown';
  } {
    const balanceSol = this.getBalanceSol();
    
    let healthStatus: 'healthy' | 'low' | 'critical' | 'unknown' = 'unknown';
    if (this.lastSnapshot) {
      if (balanceSol < CRITICAL_BALANCE_THRESHOLD_SOL) {
        healthStatus = 'critical';
      } else if (balanceSol < LOW_BALANCE_THRESHOLD_SOL) {
        healthStatus = 'low';
      } else {
        healthStatus = 'healthy';
      }
    }
    
    return {
      initialized: !!this.treasuryPda,
      treasuryPda: this.treasuryPda?.toBase58() || null,
      balanceSol,
      balanceLamports: this.getBalanceLamports().toString(),
      lastCheck: this.lastSnapshot?.timestamp || null,
      healthStatus,
    };
  }
  
  /**
   * Force a health check (for API)
   */
  async forceCheck(): Promise<ReturnType<typeof this.getStatus>> {
    await this.checkHealth();
    return this.getStatus();
  }
}

export const treasuryHealthService = new TreasuryHealthService();