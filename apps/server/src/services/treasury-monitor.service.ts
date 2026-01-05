import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

// Thresholds (in SOL)
const TREASURY_LOW_THRESHOLD = 10;      // Alert when < 10 SOL
const TREASURY_CRITICAL_THRESHOLD = 2;  // Critical when < 2 SOL
const REWARD_VAULT_LOW_THRESHOLD = 1;   // Alert when < 1 SOL
const LARGE_WITHDRAWAL_THRESHOLD = 5;   // Alert for withdrawals > 5 SOL
const WITHDRAWAL_TRACKING_WINDOW = 10 * 60 * 1000; // 10 minutes
const DRAIN_PATTERN_THRESHOLD = 3;      // 3+ withdrawals in window = suspicious

interface WithdrawalRecord {
  amount: number;
  timestamp: number;
  txSignature?: string;
}

class TreasuryMonitorService {
  private connection: Connection;
  private treasuryPDA: PublicKey | null = null;
  private rewardVaultPDA: PublicKey | null = null;
  private lastTreasuryBalance: number = 0;
  private lastRewardVaultBalance: number = 0;
  private recentWithdrawals: WithdrawalRecord[] = [];
  private initialized = false;
  private checkInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || process.env.HELIUS_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }
  
  /**
   * Initialize with PDA addresses
   */
  async initialize(treasuryPDA: string, rewardVaultPDA?: string): Promise<void> {
    try {
      this.treasuryPDA = new PublicKey(treasuryPDA);
      if (rewardVaultPDA) {
        this.rewardVaultPDA = new PublicKey(rewardVaultPDA);
      }
      
      // Get initial balances
      this.lastTreasuryBalance = await this.getBalance(this.treasuryPDA);
      if (this.rewardVaultPDA) {
        this.lastRewardVaultBalance = await this.getBalance(this.rewardVaultPDA);
      }
      
      this.initialized = true;
      console.log(`✅ Treasury monitor initialized. Treasury: ${this.lastTreasuryBalance.toFixed(4)} SOL`);
      
      // Start periodic checks
      this.startMonitoring();
      
    } catch (error: any) {
      console.error('Failed to initialize treasury monitor:', error.message);
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_LOW_BALANCE,
        message: `Treasury monitor failed to initialize: ${error.message}`,
        details: { error: error.message, treasuryPDA, rewardVaultPDA },
        source: 'treasury-monitor',
      });
    }
  }
  
  /**
   * Start periodic balance monitoring
   */
  private startMonitoring(): void {
    // Check every 30 seconds
    this.checkInterval = setInterval(() => this.checkBalances(), 30000);
    
    // Initial check
    this.checkBalances();
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
   * Get SOL balance for an address
   */
  private async getBalance(pubkey: PublicKey): Promise<number> {
    const balance = await this.connection.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  }
  
  /**
   * Check all balances and alert if needed
   */
  async checkBalances(): Promise<void> {
    if (!this.initialized || !this.treasuryPDA) return;
    
    try {
      // Check treasury
      const treasuryBalance = await this.getBalance(this.treasuryPDA);
      await this.evaluateTreasuryBalance(treasuryBalance);
      this.lastTreasuryBalance = treasuryBalance;
      
      // Check reward vault
      if (this.rewardVaultPDA) {
        const rewardVaultBalance = await this.getBalance(this.rewardVaultPDA);
        await this.evaluateRewardVaultBalance(rewardVaultBalance);
        this.lastRewardVaultBalance = rewardVaultBalance;
      }
      
    } catch (error: any) {
      console.error('Treasury balance check failed:', error.message);
    }
  }
  
  /**
   * Evaluate treasury balance and alert if needed
   */
  private async evaluateTreasuryBalance(currentBalance: number): Promise<void> {
    // Check for withdrawals (balance decreased)
    if (currentBalance < this.lastTreasuryBalance) {
      const withdrawalAmount = this.lastTreasuryBalance - currentBalance;
      await this.trackWithdrawal(withdrawalAmount);
    }
    
    // Critical balance alert
    if (currentBalance < TREASURY_CRITICAL_THRESHOLD && this.lastTreasuryBalance >= TREASURY_CRITICAL_THRESHOLD) {
      await securityMonitor.log({
        severity: 'CRITICAL',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_CRITICAL_BALANCE,
        message: `CRITICAL: Treasury balance is ${currentBalance.toFixed(4)} SOL`,
        details: {
          currentBalance,
          threshold: TREASURY_CRITICAL_THRESHOLD,
          previousBalance: this.lastTreasuryBalance,
          treasuryAddress: this.treasuryPDA?.toString(),
        },
        source: 'treasury-monitor',
      });
    }
    // Low balance alert
    else if (currentBalance < TREASURY_LOW_THRESHOLD && this.lastTreasuryBalance >= TREASURY_LOW_THRESHOLD) {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_LOW_BALANCE,
        message: `Treasury balance low: ${currentBalance.toFixed(4)} SOL`,
        details: {
          currentBalance,
          threshold: TREASURY_LOW_THRESHOLD,
          previousBalance: this.lastTreasuryBalance,
        },
        source: 'treasury-monitor',
      });
    }
    
    // Check for funding (balance increased significantly)
    if (currentBalance > this.lastTreasuryBalance + 1) { // More than 1 SOL increase
      const fundingAmount = currentBalance - this.lastTreasuryBalance;
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_FUNDED,
        message: `Treasury funded with ${fundingAmount.toFixed(4)} SOL`,
        details: {
          amount: fundingAmount,
          previousBalance: this.lastTreasuryBalance,
          newBalance: currentBalance,
        },
        source: 'treasury-monitor',
      });
    }
  }
  
  /**
   * Track withdrawal and detect suspicious patterns
   */
  private async trackWithdrawal(amount: number): Promise<void> {
    const now = Date.now();
    
    // Record this withdrawal
    this.recentWithdrawals.push({ amount, timestamp: now });
    
    // Clean old records
    this.recentWithdrawals = this.recentWithdrawals.filter(
      w => w.timestamp > now - WITHDRAWAL_TRACKING_WINDOW
    );
    
    // Alert for large withdrawals
    if (amount >= LARGE_WITHDRAWAL_THRESHOLD) {
      await securityMonitor.log({
        severity: 'CRITICAL',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_LARGE_WITHDRAWAL,
        message: `Large treasury withdrawal: ${amount.toFixed(4)} SOL`,
        details: {
          amount,
          threshold: LARGE_WITHDRAWAL_THRESHOLD,
          remainingBalance: this.lastTreasuryBalance - amount,
          recentWithdrawalsCount: this.recentWithdrawals.length,
        },
        source: 'treasury-monitor',
      });
    } else {
      // Log all withdrawals at lower severity
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_WITHDRAWAL,
        message: `Treasury withdrawal: ${amount.toFixed(4)} SOL`,
        details: {
          amount,
          remainingBalance: this.lastTreasuryBalance - amount,
        },
        source: 'treasury-monitor',
      });
    }
    
    // Check for drain pattern (multiple withdrawals in short time)
    if (this.recentWithdrawals.length >= DRAIN_PATTERN_THRESHOLD) {
      const totalWithdrawn = this.recentWithdrawals.reduce((sum, w) => sum + w.amount, 0);
      
      await securityMonitor.log({
        severity: 'CRITICAL',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.TREASURY_DRAIN_PATTERN,
        message: `Suspicious withdrawal pattern: ${this.recentWithdrawals.length} withdrawals in ${WITHDRAWAL_TRACKING_WINDOW / 60000} minutes`,
        details: {
          withdrawalCount: this.recentWithdrawals.length,
          totalWithdrawn,
          timeWindowMinutes: WITHDRAWAL_TRACKING_WINDOW / 60000,
          withdrawals: this.recentWithdrawals,
        },
        source: 'treasury-monitor',
      });
    }
  }
  
  /**
   * Evaluate reward vault balance
   */
  private async evaluateRewardVaultBalance(currentBalance: number): Promise<void> {
    // Empty vault alert
    if (currentBalance < 0.001 && this.lastRewardVaultBalance >= 0.001) {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.REWARD_VAULT_EMPTY,
        message: 'Reward vault is empty - stakers cannot claim rewards',
        details: {
          currentBalance,
          previousBalance: this.lastRewardVaultBalance,
          rewardVaultAddress: this.rewardVaultPDA?.toString(),
        },
        source: 'treasury-monitor',
      });
    }
    // Low balance alert
    else if (currentBalance < REWARD_VAULT_LOW_THRESHOLD && this.lastRewardVaultBalance >= REWARD_VAULT_LOW_THRESHOLD) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.REWARD_VAULT_LOW_BALANCE,
        message: `Reward vault balance low: ${currentBalance.toFixed(4)} SOL`,
        details: {
          currentBalance,
          threshold: REWARD_VAULT_LOW_THRESHOLD,
        },
        source: 'treasury-monitor',
      });
    }
    
    // Check for funding
    if (currentBalance > this.lastRewardVaultBalance + 0.1) { // More than 0.1 SOL increase
      const fundingAmount = currentBalance - this.lastRewardVaultBalance;
      await securityMonitor.log({
        severity: 'LOW',
        category: 'Treasury',
        eventType: SECURITY_EVENT_TYPES.REWARD_VAULT_FUNDED,
        message: `Reward vault funded with ${fundingAmount.toFixed(4)} SOL`,
        details: {
          amount: fundingAmount,
          previousBalance: this.lastRewardVaultBalance,
          newBalance: currentBalance,
        },
        source: 'treasury-monitor',
      });
    }
  }
  
  /**
   * Manually log a treasury funding event
   */
  async logTreasuryFunded(amount: number, funder: string, txSignature?: string): Promise<void> {
    await securityMonitor.log({
      severity: 'LOW',
      category: 'Treasury',
      eventType: SECURITY_EVENT_TYPES.TREASURY_FUNDED,
      message: `Treasury funded with ${amount.toFixed(4)} SOL`,
      details: {
        amount,
        funder,
        txSignature,
        newBalance: this.lastTreasuryBalance + amount,
      },
      source: 'treasury-monitor',
      userId: funder,
      txSignature,
    });
  }
  
  /**
   * Get current status
   */
  getStatus(): {
    initialized: boolean;
    treasuryBalance: number;
    rewardVaultBalance: number;
    recentWithdrawals: number;
    thresholds: {
      treasuryLow: number;
      treasuryCritical: number;
      rewardVaultLow: number;
      largeWithdrawal: number;
    };
  } {
    return {
      initialized: this.initialized,
      treasuryBalance: this.lastTreasuryBalance,
      rewardVaultBalance: this.lastRewardVaultBalance,
      recentWithdrawals: this.recentWithdrawals.length,
      thresholds: {
        treasuryLow: TREASURY_LOW_THRESHOLD,
        treasuryCritical: TREASURY_CRITICAL_THRESHOLD,
        rewardVaultLow: REWARD_VAULT_LOW_THRESHOLD,
        largeWithdrawal: LARGE_WITHDRAWAL_THRESHOLD,
      },
    };
  }
}

export const treasuryMonitor = new TreasuryMonitorService();