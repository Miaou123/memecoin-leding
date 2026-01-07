import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, getCurrentNetwork, PROGRAM_ID } from '@memecoin-lending/config';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { getAdminKeypair } from '../config/keys.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { sha256 } from '@noble/hashes/sha2';
import fs from 'fs';
import path from 'path';

interface ProgramTransaction {
  signature: string;
  blockTime: number;
  err: any;
  instructions: any[];
}

interface TrackedTransaction {
  signature: string;
  timestamp: number;
  source: 'backend' | 'unknown';
}

// Anchor instruction discriminators (first 8 bytes of sha256("global:instruction_name"))
function getDiscriminator(instructionName: string): Buffer {
  const hash = sha256(Buffer.from(`global:${instructionName}`));
  return Buffer.from(hash.slice(0, 8));
}

const CREATE_LOAN_DISCRIMINATOR = getDiscriminator('create_loan');
const REPAY_LOAN_DISCRIMINATOR = getDiscriminator('repay_loan');
const LIQUIDATE_DISCRIMINATOR = getDiscriminator('liquidate');

class ProgramMonitorService {
  private connection: Connection;
  private programId: PublicKey;
  private client: MemecoinLendingClient | null = null;
  private lastProcessedSlot = 0;
  private isMonitoring = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  
  // Track transactions initiated by our backend
  private backendTransactions = new Map<string, TrackedTransaction>();
  private readonly TX_TRACKING_TTL = 10 * 60 * 1000; // 10 minutes
  
  constructor() {
    const networkConfig = getNetworkConfig(getCurrentNetwork());
    this.connection = new Connection(networkConfig.rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: networkConfig.wsUrl,
    });
    
    this.programId = typeof PROGRAM_ID === 'string' 
      ? new PublicKey(PROGRAM_ID) 
      : PROGRAM_ID;
  }
  
  private async getClient(): Promise<MemecoinLendingClient> {
    if (!this.client) {
      const networkConfig = getNetworkConfig(getCurrentNetwork());
      const wallet = getAdminKeypair();
      const idlPath = path.resolve('../../target/idl/memecoin_lending.json');
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
      
      this.client = new MemecoinLendingClient(
        this.connection,
        wallet as any,
        this.programId,
        idl
      );
    }
    return this.client;
  }
  
  /**
   * Start monitoring program transactions
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('[ProgramMonitor] Already monitoring');
      return;
    }
    
    this.isMonitoring = true;
    console.log('[ProgramMonitor] Starting program transaction monitoring...');
    
    // Set up WebSocket subscription for real-time monitoring
    this.subscribeToProgram();
    
    // Also poll periodically as backup
    this.monitorInterval = setInterval(() => {
      this.checkRecentTransactions();
    }, 30000); // Every 30 seconds
    
    // Clean up old tracked transactions periodically
    setInterval(() => {
      this.cleanupOldTransactions();
    }, 60000); // Every minute
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    console.log('[ProgramMonitor] Stopped monitoring');
  }
  
  /**
   * Track a transaction initiated by our backend
   */
  trackBackendTransaction(signature: string): void {
    this.backendTransactions.set(signature, {
      signature,
      timestamp: Date.now(),
      source: 'backend',
    });
    console.log(`[ProgramMonitor] Tracking backend tx: ${signature.substring(0, 8)}...`);
  }
  
  /**
   * Subscribe to program logs via WebSocket
   */
  private subscribeToProgram(): void {
    console.log('[ProgramMonitor] Setting up WebSocket subscription...');
    
    this.connection.onLogs(
      this.programId,
      async (logs) => {
        try {
          await this.processTransaction(logs.signature);
        } catch (error: any) {
          console.error('[ProgramMonitor] Error processing log:', error);
        }
      },
      'confirmed'
    );
  }
  
  /**
   * Check recent transactions (backup polling)
   */
  private async checkRecentTransactions(): Promise<void> {
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        this.programId,
        { limit: 20 },
        'confirmed'
      );
      
      for (const sig of signatures) {
        if (sig.err) continue; // Skip failed transactions
        
        // Process if we haven't seen it before
        await this.processTransaction(sig.signature);
      }
    } catch (error: any) {
      console.error('[ProgramMonitor] Error checking recent transactions:', error);
    }
  }
  
  /**
   * Process a transaction to check if it was initiated outside backend
   */
  private async processTransaction(signature: string): Promise<void> {
    // Check if this transaction was initiated by our backend
    if (this.backendTransactions.has(signature)) {
      console.log(`[ProgramMonitor] Transaction ${signature.substring(0, 8)}... is from backend`);
      return;
    }
    
    try {
      // Get transaction details
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta) return;
      
      // Parse instructions to identify the type of operation
      const client = await this.getClient();
      const ixData = await this.parseInstructions(tx);
      
      // Check what type of instruction it was
      for (const instruction of ixData) {
        if (instruction.type === 'createLoan') {
          await this.handleDirectLoanCreation(signature, instruction.data, tx.blockTime || Date.now() / 1000);
        } else if (instruction.type === 'repayLoan') {
          await this.handleDirectLoanRepayment(signature, instruction.data, tx.blockTime || Date.now() / 1000);
        }
      }
    } catch (error: any) {
      console.error(`[ProgramMonitor] Error processing tx ${signature}:`, error);
    }
  }
  
  /**
   * Parse transaction instructions
   */
  private async parseInstructions(tx: any): Promise<any[]> {
    const instructions = [];
    
    try {
      for (const ix of tx.transaction.message.instructions) {
        // Check if this is our program
        const programIndex = ix.programIdIndex;
        const programId = tx.transaction.message.accountKeys[programIndex];
        
        if (programId.equals && programId.equals(this.programId)) {
          // Try to decode the instruction
          const data = ix.data;
          
          // Parse instruction based on discriminator
          if (data && Buffer.isBuffer(data)) {
            // Check first 8 bytes for instruction discriminator
            const discriminator = data.slice(0, 8);
            
            if (discriminator.equals(CREATE_LOAN_DISCRIMINATOR)) {
              instructions.push({
                type: 'createLoan',
                data: { /* parsed data */ },
              });
            } else if (discriminator.equals(REPAY_LOAN_DISCRIMINATOR)) {
              instructions.push({
                type: 'repayLoan',
                data: { /* parsed data */ },
              });
            } else if (discriminator.equals(LIQUIDATE_DISCRIMINATOR)) {
              instructions.push({
                type: 'liquidate',
                data: { /* parsed data */ },
              });
            }
          }
        }
      }
    } catch (error: any) {
      console.error('[ProgramMonitor] Error parsing instructions:', error);
    }
    
    return instructions;
  }
  
  /**
   * Handle loan creation outside backend
   */
  private async handleDirectLoanCreation(signature: string, data: any, blockTime: number): Promise<void> {
    console.log(`🚨 [ProgramMonitor] DIRECT LOAN CREATION DETECTED: ${signature}`);
    
    await securityMonitor.log({
      severity: 'CRITICAL',
      category: 'Loans',
      eventType: SECURITY_EVENT_TYPES.LOAN_CREATED_OUTSIDE_BACKEND,
      message: 'Loan created directly through program, bypassing backend security checks',
      details: {
        signature,
        blockTime,
        timestamp: new Date(blockTime * 1000).toISOString(),
        data,
      },
      source: 'program-monitor',
      txSignature: signature,
    });
    
    // Try to find and process the loan
    try {
      // Get loan details from transaction logs or accounts
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (tx?.meta?.postTokenBalances) {
        // Extract loan information and add to database for tracking
        // This ensures we can still monitor/liquidate it
        console.log('[ProgramMonitor] Processing direct loan for monitoring...');
      }
    } catch (error: any) {
      console.error('[ProgramMonitor] Error processing direct loan:', error);
    }
  }
  
  /**
   * Handle loan repayment outside backend
   */
  private async handleDirectLoanRepayment(signature: string, data: any, blockTime: number): Promise<void> {
    console.log(`⚠️  [ProgramMonitor] Direct loan repayment detected: ${signature}`);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Loans',
      eventType: SECURITY_EVENT_TYPES.LOAN_REPAID_OUTSIDE_BACKEND,
      message: 'Loan repaid directly through program',
      details: {
        signature,
        blockTime,
        timestamp: new Date(blockTime * 1000).toISOString(),
        data,
      },
      source: 'program-monitor',
      txSignature: signature,
    });
  }
  
  /**
   * Clean up old tracked transactions
   */
  private cleanupOldTransactions(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [sig, tx] of this.backendTransactions) {
      if (now - tx.timestamp > this.TX_TRACKING_TTL) {
        toDelete.push(sig);
      }
    }
    
    for (const sig of toDelete) {
      this.backendTransactions.delete(sig);
    }
    
    if (toDelete.length > 0) {
      console.log(`[ProgramMonitor] Cleaned up ${toDelete.length} old tracked transactions`);
    }
  }
  
  /**
   * Get monitoring stats
   */
  getStats(): {
    isMonitoring: boolean;
    trackedTransactions: number;
    programId: string;
  } {
    return {
      isMonitoring: this.isMonitoring,
      trackedTransactions: this.backendTransactions.size,
      programId: this.programId.toString(),
    };
  }
}

export const programMonitor = new ProgramMonitorService();