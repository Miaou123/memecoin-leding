import { PublicKey, Connection, Keypair, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import { 
  Loan, 
  LoanEstimate,
  CreateLoanRequest,
  LoanStatus,
  WebSocketEvent,
  TokenTier,
  TokenConfig,
  PoolType,
} from '@memecoin-lending/types';
import { MemecoinLendingClient, buildCreateLoanTransaction, buildRepayLoanTransaction, liquidateWithPumpfun, liquidateWithJupiter } from '@memecoin-lending/sdk';
import { prisma } from '../db/client.js';
import { priceService } from './price.service.js';
import { notificationService } from './notification.service.js';
import { fastPriceMonitor } from './fast-price-monitor.js';
import { websocketService } from '../websocket/index.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { PROGRAM_ID, getNetworkConfig, getCurrentNetwork } from '@memecoin-lending/config';

// Helper functions for manual TokenConfig deserialization
function readPubkey(buffer: Buffer, offset: number): PublicKey {
  return new PublicKey(buffer.slice(offset, offset + 32));
}

function readU16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readU64(buffer: Buffer, offset: number): BN {
  return new BN(buffer.slice(offset, offset + 8), 'le');
}

function readBool(buffer: Buffer, offset: number): boolean {
  return buffer[offset] !== 0;
}

function readU8(buffer: Buffer, offset: number): number {
  return buffer[offset];
}

// Helper to parse tier from byte
function parseTierFromByte(tierByte: number): TokenTier {
  switch (tierByte) {
    case 1: return TokenTier.Silver;
    case 2: return TokenTier.Gold;
    default: return TokenTier.Bronze;
  }
}

// Helper to parse pool type from byte
function parsePoolTypeFromByte(poolTypeByte: number): PoolType {
  switch (poolTypeByte) {
    case 1: return PoolType.Orca;
    case 2: return PoolType.Pumpfun;
    case 3: return PoolType.PumpSwap;
    default: return PoolType.Raydium;
  }
}

class LoanService {
  private client: MemecoinLendingClient | null = null;
  
  private async getClient(): Promise<MemecoinLendingClient> {
    if (!this.client) {
      const networkConfig = getNetworkConfig(getCurrentNetwork());
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load wallet from file
      const keypairPath = path.resolve(process.env.ADMIN_KEYPAIR_PATH || '../../scripts/keys/admin.json');
      const keyData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      const wallet = Keypair.fromSecretKey(Uint8Array.from(keyData));
      
      // Load IDL from target folder
      const idlPath = path.resolve('../../target/idl/memecoin_lending.json');
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
      
      const programId = typeof PROGRAM_ID === 'string' 
        ? new PublicKey(PROGRAM_ID) 
        : PROGRAM_ID;
      
      this.client = new MemecoinLendingClient(
        connection,
        wallet as any,
        programId,
        idl
      );
    }
    return this.client;
  }
  
  formatLoan(loan: any): Loan {
    return {
      pubkey: loan.id,
      borrower: loan.borrower,
      tokenMint: loan.tokenMint,
      collateralAmount: loan.collateralAmount,
      solBorrowed: loan.solBorrowed,
      entryPrice: loan.entryPrice,
      liquidationPrice: loan.liquidationPrice,
      createdAt: Math.floor(loan.createdAt.getTime() / 1000),
      dueAt: Math.floor(loan.dueAt.getTime() / 1000),
      status: loan.status as LoanStatus,
      index: 0, // TODO: Store index in DB
    };
  }
  
  async estimateLoan(params: CreateLoanRequest): Promise<LoanEstimate> {
    const client = await this.getClient();
    
    console.log('[LoanService] Program ID:', client.program.programId.toString());
    
    // Import tokenVerificationService dynamically to avoid circular dependency
    const { tokenVerificationService } = await import('./token-verification.service.js');
    
    // First verify and potentially auto-whitelist the token
    console.log('[LoanService] Verifying token:', params.tokenMint.substring(0, 8) + '...');
    const verification = await tokenVerificationService.verifyToken(params.tokenMint);
    
    if (!verification.isValid) {
      throw new Error(verification.reason || 'Token not eligible for loans');
    }
    
    // Check if token is whitelisted in DB
    const token = await prisma.token.findUnique({
      where: { id: params.tokenMint },
    });
    
    if (!token || !token.enabled) {
      throw new Error('Token not whitelisted or disabled');
    }
    
    // Use database token info (already fetched above as `token`)
    // Map tier to LTV basis points based on tier
    const tierToLtv: Record<string, number> = {
      'bronze': 5000,  // 50%
      'silver': 6000,  // 60%
      'gold': 7000,    // 70%
    };

    const tokenConfig: TokenConfig = {
      pubkey: '',
      mint: params.tokenMint,
      tier: (token.tier.charAt(0).toUpperCase() + token.tier.slice(1)) as TokenTier,
      enabled: token.enabled,
      poolAddress: token.poolAddress,
      poolType: PoolType.Pumpfun, // Default for PumpFun tokens
      ltvBps: tierToLtv[token.tier.toLowerCase()] || 5000,
      minLoanAmount: '1000000', // 0.001 SOL in lamports
      maxLoanAmount: '100000000000', // 100 SOL in lamports
      activeLoansCount: '0',
      totalVolume: '0',
      isProtocolToken: false, // Manual whitelist tokens are not protocol tokens
    };

    console.log('[LoanService] Using DB token config:', {
      mint: token.id.substring(0, 8) + '...',
      tier: token.tier,
      ltvBps: tokenConfig.ltvBps,
      enabled: token.enabled,
    });
    
    // Calculate loan terms
    const currentPrice = await priceService.getCurrentPrice(params.tokenMint);

    // Convert price to lamports (BN can only handle integers)
    // Price from service is in USD, we need to convert to lamports
    // First get the SOL price, then convert token price to SOL, then to lamports
    const solUsdPrice = await priceService.getSolPrice();
    const tokenUsdPrice = parseFloat(currentPrice.price);
    const tokenSolPrice = tokenUsdPrice / solUsdPrice; // Price in SOL
    const priceInLamports = Math.round(tokenSolPrice * 1e9).toString(); // Convert to lamports

    console.log('[LoanService] Price conversion:', {
      tokenUsdPrice,
      solUsdPrice,
      tokenSolPrice,
      priceInLamports,
    });

    const loanTerms = client.calculateLoanTerms({
      tokenMint: params.tokenMint,
      collateralAmount: params.collateralAmount,
      durationSeconds: params.durationSeconds,
      currentPrice: priceInLamports,
      tokenConfig,
      tokenDecimals: token.decimals || 6, // Use decimals from DB token record
    });
    
    return {
      solAmount: loanTerms.solAmount,
      protocolFeeBps: 200, // 2% flat fee
      totalOwed: loanTerms.totalOwed,
      liquidationPrice: loanTerms.liquidationPrice,
      ltv: loanTerms.ltv,
      fees: {
        protocolFee: (parseFloat(loanTerms.solAmount) * 0.02).toString(),
        interest: '0', // No interest anymore
      },
    };
  }
  
  async createLoan(params: CreateLoanRequest & { borrower: string }): Promise<{ transaction: string }> {
    try {
      const client = await this.getClient();
      
      // Import tokenVerificationService dynamically to avoid circular dependency
      const { tokenVerificationService } = await import('./token-verification.service.js');
      
      // First verify and potentially auto-whitelist the token
      console.log('[LoanService] Verifying token for loan creation:', params.tokenMint.substring(0, 8) + '...');
      const verification = await tokenVerificationService.verifyToken(params.tokenMint);
      
      if (!verification.isValid) {
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'Loans',
          eventType: SECURITY_EVENT_TYPES.LOAN_INVALID_COLLATERAL,
          message: `Loan creation attempted with invalid token`,
          details: {
            tokenMint: params.tokenMint,
            reason: verification.reason,
            borrower: params.borrower,
            collateralAmount: params.collateralAmount,
          },
          source: 'loan-service',
          userId: params.borrower,
        });
        throw new Error(verification.reason || 'Token not eligible for loans');
      }
      
      // Check treasury balance before proceeding  
      const loanEstimate = await this.estimateLoan(params);
      // TODO: Add treasury balance check when getTreasuryBalance method is available
      // const treasuryBalance = await this.getTreasuryBalance();
      // const requiredSol = parseFloat(loanEstimate.loanTerms.solAmount);
      
      // if (treasuryBalance < requiredSol) {
      //   await securityMonitor.log({
      //     severity: 'HIGH',
      //     category: 'Loans',
      //     eventType: SECURITY_EVENT_TYPES.LOAN_TREASURY_INSUFFICIENT,
      //     message: 'Treasury has insufficient funds for loan',
      //     details: {
      //       requested: requiredSol,
      //       available: treasuryBalance,
      //       borrower: params.borrower,
      //       tokenMint: params.tokenMint,
      //     },
      //     source: 'loan-service',
      //     userId: params.borrower,
      //   });
      //   throw new Error('Insufficient treasury balance');
      // }
      
      // Build unsigned transaction
      const tx = await buildCreateLoanTransaction(client.program, {
        tokenMint: new PublicKey(params.tokenMint),
        collateralAmount: new BN(params.collateralAmount),
        durationSeconds: new BN(params.durationSeconds),
        borrower: new PublicKey(params.borrower),
      });
      
      // Get recent blockhash
      const { blockhash } = await client.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = new PublicKey(params.borrower);
      
      // SECURITY: Track token for real-time price monitoring via WebSocket
      priceService.trackToken(params.tokenMint);
      
      // Serialize and return (unsigned)
      const serializedTx = tx.serialize({ 
        requireAllSignatures: false,
        verifySignatures: false 
      }).toString('base64');
      
      return { transaction: serializedTx };
      
    } catch (error: any) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Loans',
        eventType: SECURITY_EVENT_TYPES.LOAN_CREATION_FAILED,
        message: `Loan creation failed: ${error.message}`,
        details: {
          borrower: params.borrower,
          tokenMint: params.tokenMint,
          collateralAmount: params.collateralAmount,
          durationSeconds: params.durationSeconds,
          error: error.message,
          stack: error.stack?.slice(0, 500),
        },
        source: 'loan-service',
        userId: params.borrower,
      });
      throw error;
    }
  }
  
  async buildRepayTransaction(loanPubkey: string, repayer: string): Promise<{ transaction: string }> {
    const client = await this.getClient();
    
    // Get loan from database
    const dbLoan = await prisma.loan.findUnique({
      where: { id: loanPubkey },
    });
    
    if (!dbLoan) {
      throw new Error('Loan not found');
    }
    
    if (dbLoan.borrower !== repayer) {
      throw new Error('Only borrower can repay loan');
    }
    
    if (dbLoan.status !== LoanStatus.Active) {
      throw new Error('Loan is not active');
    }
    
    // Build unsigned transaction using the new function
    const tx = await buildRepayLoanTransaction(
      client.program,
      new PublicKey(loanPubkey),
      new PublicKey(repayer)
    );
    
    // Get recent blockhash
    const { blockhash } = await client.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = new PublicKey(repayer);
    
    // Return serialized unsigned transaction
    const serializedTx = tx.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false 
    }).toString('base64');
    
    return { transaction: serializedTx };
  }

  async repayLoan(loanPubkey: string, repayer: string): Promise<Loan> {
    try {
      const client = await this.getClient();
      
      // Get loan from database
      const dbLoan = await prisma.loan.findUnique({
        where: { id: loanPubkey },
      });
      
      if (!dbLoan) {
        throw new Error('Loan not found');
      }
      
      if (dbLoan.borrower !== repayer) {
        throw new Error('Only borrower can repay loan');
      }
      
      if (dbLoan.status !== LoanStatus.Active) {
        throw new Error('Loan is not active');
      }
      
      // Repay loan on-chain
      const txSignature = await client.repayLoan(new PublicKey(loanPubkey));
    
    // Update database
    const updatedLoan = await prisma.loan.update({
      where: { id: loanPubkey },
      data: {
        status: LoanStatus.Repaid,
        repaidAt: new Date(),
      },
      include: { token: true },
    });

    // Remove from price monitoring
    try {
      fastPriceMonitor.removeLiquidationThreshold(dbLoan.tokenMint, loanPubkey);
    } catch (e) {
      // Ignore
    }
    
    // Create notification
    await notificationService.createNotification({
      userId: dbLoan.borrower,
      type: 'loan_repaid',
      title: 'Loan Repaid',
      message: 'Your loan has been successfully repaid',
      loanId: loanPubkey,
    });
    
    // Emit websocket event
    websocketService.emit(WebSocketEvent.LOAN_REPAID, {
      loanPubkey,
      borrower: dbLoan.borrower,
      totalRepaid: dbLoan.solBorrowed, // TODO: Calculate with interest
      txSignature,
    });
    
    return this.formatLoan(updatedLoan);
    
    } catch (error: any) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Loans',
        eventType: SECURITY_EVENT_TYPES.LOAN_REPAY_FAILED,
        message: `Loan repayment failed: ${error.message}`,
        details: {
          loanPubkey,
          repayer,
          error: error.message,
        },
        source: 'loan-service',
        userId: repayer,
      });
      throw error;
    }
  }
  
  async confirmRepayment(loanPubkey: string, txSignature: string): Promise<Loan> {
    // Verify the loan exists
    const existingLoan = await prisma.loan.findUnique({
      where: { id: loanPubkey },
    });
    
    if (!existingLoan) {
      throw new Error('Loan not found');
    }
    
    if (existingLoan.status !== 'active') {
      throw new Error('Loan is not active');
    }
    
    // Calculate protocol fee (1% flat)
    const principal = BigInt(existingLoan.solBorrowed);
    const protocolFee = principal / BigInt(100); // 1%
    
    // Update loan status in database
    const updatedLoan = await prisma.loan.update({
      where: { id: loanPubkey },
      data: {
        status: 'repaid',
        repaidAt: new Date(),
      },
      include: { token: true },
    });
    
    console.log(`[LoanService] Loan ${loanPubkey.substring(0, 8)}... marked as repaid. Tx: ${txSignature.substring(0, 8)}...`);
    
    // Remove from price monitoring
    try {
      fastPriceMonitor.removeLiquidationThreshold(existingLoan.tokenMint, loanPubkey);
    } catch (e) {
      // Ignore
    }
    
    // Create notification for user
    try {
      // Ensure user exists first
      await prisma.user.upsert({
        where: { id: existingLoan.borrower },
        update: {},
        create: { id: existingLoan.borrower },
      });
      
      await notificationService.createNotification({
        userId: existingLoan.borrower,
        type: 'loan_repaid',
        title: 'Loan Repaid Successfully',
        message: `Your loan of ${this.formatSOL(existingLoan.solBorrowed)} SOL has been repaid`,
        loanId: loanPubkey,
      });
    } catch (notifError: any) {
      console.warn('[LoanService] Failed to create repayment notification:', notifError.message);
      // Don't fail the whole operation for notification errors
    }
    
    // Emit websocket event
    try {
      websocketService.emit(WebSocketEvent.LOAN_REPAID, {
        loanPubkey,
        borrower: existingLoan.borrower,
        principal: existingLoan.solBorrowed,
        protocolFee: protocolFee.toString(),
        txSignature,
      });
    } catch (wsError: any) {
      console.warn('[LoanService] Failed to emit websocket event:', wsError.message);
    }
    
    return this.formatLoan(updatedLoan);
  }
  
  async liquidateLoan(loanPubkey: string, liquidator: string): Promise<Loan> {
    const client = await this.getClient();
    
    // Check if loan is liquidatable
    const isLiquidatable = await client.isLoanLiquidatable(new PublicKey(loanPubkey));
    if (!isLiquidatable) {
      throw new Error('Loan is not liquidatable');
    }
    
    // Get loan data and token config to determine pool type
    const dbLoan = await prisma.loan.findUnique({
      where: { id: loanPubkey },
      include: { token: true },
    });
    
    if (!dbLoan) {
      throw new Error('Loan not found');
    }
    
    // Get token configuration from on-chain data
    const tokenMintPubkey = new PublicKey(dbLoan.tokenMint);
    const tokenConfig = await client.getTokenConfig(tokenMintPubkey);
    
    if (!tokenConfig) {
      throw new Error('Token configuration not found on-chain');
    }
    
    // SECURITY: Implement liquidation with retry mechanism and slippage escalation
    let txSignature: string | undefined;
    let lastError: Error | null = null;
    
    const maxRetries = 6; // 3% → 5% → 7% → 9% → 11% → 15%
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Calculate slippage for this attempt: 3% → 5% → 7% → 9% → 11% → 15%
        const slippageLevels = [300, 500, 700, 900, 1100, 1500]; // basis points (6 levels)
        const currentSlippageBps = slippageLevels[attempt];
        
        console.log(`🔄 Liquidation attempt ${attempt + 1}/${maxRetries} for ${loanPubkey} with ${currentSlippageBps/100}% slippage`);
        
        // Execute liquidation based on pool type
        if (tokenConfig.poolType === PoolType.Pumpfun) {
          console.log(`🔥 Liquidating PumpFun loan ${loanPubkey} via bonding curve`);
          // Note: liquidateWithPumpfun may not support slippage parameter yet
          txSignature = await liquidateWithPumpfun(
            client.program,
            new PublicKey(loanPubkey),
            client.connection
          );
        } else {
          // Use Jupiter for Raydium, Orca, and PumpSwap
          console.log(`🔥 Liquidating ${tokenConfig.poolType} loan ${loanPubkey} via Jupiter`);
          txSignature = await liquidateWithJupiter(
            client.program,
            new PublicKey(loanPubkey),
            currentSlippageBps
          );
        }
        
        // Success! Now wait for on-chain confirmation
        console.log(`📤 Transaction sent: ${txSignature}`);
        
        // CRITICAL: Wait for on-chain confirmation
        const connection = client.connection;
        const startTime = Date.now();
        const timeout = 60000; // 60 seconds
        
        while (Date.now() - startTime < timeout) {
          const status = await connection.getSignatureStatus(txSignature);
          
          if (status.value?.confirmationStatus === 'confirmed' || 
              status.value?.confirmationStatus === 'finalized') {
            console.log(`✅ Transaction CONFIRMED on-chain: ${txSignature}`);
            break;
          }
          
          if (status.value?.err) {
            throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
          }
          
          await new Promise(r => setTimeout(r, 1000));
        }
        
        // Double-check loan state changed
        try {
          const loanAfter = await (client.program.account as any).loan.fetch(new PublicKey(loanPubkey));
          if (loanAfter && (loanAfter.status as any).active) {
            throw new Error('Loan still active after liquidation - TX may have failed');
          }
          console.log(`✅ Loan status confirmed changed after liquidation`);
        } catch (fetchError) {
          console.log(`✅ Loan account no longer exists or changed - liquidation confirmed`);
        }
        
        console.log(`✅ Liquidation successful and CONFIRMED on attempt ${attempt + 1}`);
        break;
        
      } catch (error) {
        lastError = error as Error;
        console.warn(`❌ Liquidation attempt ${attempt + 1} failed:`, error);
        
        // If this is the last attempt, throw the error
        if (attempt === maxRetries - 1) {
          console.error(`🚨 All ${maxRetries} liquidation attempts failed for ${loanPubkey}`);
          throw new Error(`Liquidation failed after ${maxRetries} attempts: ${lastError.message}`);
        }
        
        // Wait before next attempt (exponential backoff: 1s, 2s, 4s)
        const backoffMs = 1000 * Math.pow(2, attempt);
        console.log(`⏱️  Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
    
    // Ensure liquidation was successful
    if (!txSignature) {
      throw new Error('Liquidation failed: no transaction signature received');
    }
    
    // Determine liquidation reason
    const currentTime = Math.floor(Date.now() / 1000);
    const dueTime = Math.floor(dbLoan.dueAt.getTime() / 1000);
    const liquidationReason = currentTime > dueTime ? 'time' : 'price';
    
    // Update database
    const updatedLoan = await prisma.loan.update({
      where: { id: loanPubkey },
      data: {
        status: liquidationReason === 'time' 
          ? LoanStatus.LiquidatedTime 
          : LoanStatus.LiquidatedPrice,
        liquidatedAt: new Date(),
        liquidationReason,
      },
      include: { token: true },
    });
    
    console.log(`✅ Loan ${loanPubkey} liquidated successfully (${liquidationReason}) - TX: ${txSignature}`);
    
    // Remove from monitoring
    fastPriceMonitor.removeLiquidationThreshold(dbLoan.tokenMint, loanPubkey);
    
    // Create notification
    await notificationService.createNotification({
      userId: dbLoan.borrower,
      type: 'loan_liquidated',
      title: 'Loan Liquidated',
      message: `Your loan has been liquidated due to ${liquidationReason === 'time' ? 'expiry' : 'price drop'}`,
      loanId: loanPubkey,
    });
    
    // Emit websocket event
    websocketService.emit(WebSocketEvent.LOAN_LIQUIDATED, {
      loanPubkey,
      borrower: dbLoan.borrower,
      liquidator,
      reason: liquidationReason,
      poolType: tokenConfig.poolType,
      txSignature,
    });
    
    return this.formatLoan(updatedLoan);
  }  
  async trackCreatedLoan(params: {
    loanPubkey: string;
    txSignature: string;
    borrower: string;
    tokenMint: string;
  }): Promise<Loan> {
    const client = await this.getClient();
    
    let loanPubkey = params.loanPubkey;
    
    // If no loan PDA provided, find it by parsing the transaction
    if (!loanPubkey || loanPubkey === '') {
      console.log('[LoanService] Finding loan PDA from transaction:', params.txSignature.substring(0, 8) + '...');
      loanPubkey = await this.findLoanPDAFromTransaction(params.txSignature, params.borrower, params.tokenMint);
    }
    
    // Fetch loan data from chain
    const loanAccount = await (client.program.account as any).loan.fetch(
      new PublicKey(loanPubkey)
    );
    
    if (!loanAccount) {
      throw new Error('Loan not found on-chain');
    }
    
    // Get token info
    const token = await prisma.token.findUnique({
      where: { id: params.tokenMint },
    });
    
    // Create database record
    const dbLoan = await prisma.loan.create({
      data: {
        id: loanPubkey,
        borrower: params.borrower,
        tokenMint: params.tokenMint,
        collateralAmount: loanAccount.collateralAmount.toString(),
        solBorrowed: loanAccount.solBorrowed.toString(),
        entryPrice: loanAccount.entryPrice.toString(),
        liquidationPrice: loanAccount.liquidationPrice.toString(),
        createdAt: new Date(loanAccount.createdAt.toNumber() * 1000),
        dueAt: new Date(loanAccount.dueAt.toNumber() * 1000),
        status: LoanStatus.Active,
      },
      include: { token: true },
    });

    // Security monitoring for large loans and burst activity
    const solAmount = parseFloat(dbLoan.solBorrowed) / 1e9; // Convert lamports to SOL
    const LARGE_LOAN_THRESHOLD = 10; // SOL
    
    // Monitor large loans
    if (solAmount >= LARGE_LOAN_THRESHOLD) {
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Loans',
        eventType: SECURITY_EVENT_TYPES.LOAN_LARGE_AMOUNT,
        message: `Large loan created: ${solAmount.toFixed(4)} SOL`,
        details: {
          loanId: loanPubkey,
          borrower: params.borrower,
          tokenMint: params.tokenMint,
          solAmount: solAmount,
          collateralAmount: dbLoan.collateralAmount,
          entryPrice: dbLoan.entryPrice,
          liquidationPrice: dbLoan.liquidationPrice,
          threshold: LARGE_LOAN_THRESHOLD,
        },
        source: 'loan-service',
        userId: params.borrower,
        txSignature: params.txSignature,
      });
    }
    
    // Monitor burst activity (multiple loans from same user in short time)
    const BURST_WINDOW_MINUTES = 10;
    const BURST_THRESHOLD = 3; // 3+ loans in 10 minutes
    const burstWindowStart = new Date(Date.now() - BURST_WINDOW_MINUTES * 60 * 1000);
    
    const recentLoans = await prisma.loan.count({
      where: {
        borrower: params.borrower,
        createdAt: {
          gte: burstWindowStart,
        },
        status: LoanStatus.Active,
      },
    });
    
    if (recentLoans >= BURST_THRESHOLD) {
      const recentLoansList = await prisma.loan.findMany({
        where: {
          borrower: params.borrower,
          createdAt: {
            gte: burstWindowStart,
          },
        },
        select: {
          id: true,
          solBorrowed: true,
          tokenMint: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      
      const totalBorrowed = recentLoansList.reduce((sum, loan) => 
        sum + (parseFloat(loan.solBorrowed) / 1e9), 0
      );
      
      await securityMonitor.log({
        severity: 'CRITICAL',
        category: 'Loans',
        eventType: SECURITY_EVENT_TYPES.LOAN_BURST_ACTIVITY,
        message: `Burst loan activity detected: ${recentLoans} loans in ${BURST_WINDOW_MINUTES} minutes`,
        details: {
          borrower: params.borrower,
          loansCount: recentLoans,
          totalBorrowed: totalBorrowed,
          timeWindowMinutes: BURST_WINDOW_MINUTES,
          threshold: BURST_THRESHOLD,
          recentLoans: recentLoansList,
        },
        source: 'loan-service',
        userId: params.borrower,
        txSignature: params.txSignature,
      });
    }

    // Register for price monitoring
    try {
      fastPriceMonitor.registerLiquidationThreshold(
        params.tokenMint,
        dbLoan.id,
        parseFloat(dbLoan.liquidationPrice),
        dbLoan.borrower,
        parseFloat(dbLoan.solBorrowed),
        parseFloat(dbLoan.entryPrice)
      );
      console.log(`📡 Registered monitoring for loan ${dbLoan.id.slice(0, 8)}...`);
    } catch (monitorError: any) {
      console.warn(`⚠️ Failed to register price monitoring:`, monitorError.message);
    }
    
    // Ensure user exists before creating notification
    await prisma.user.upsert({
      where: { id: params.borrower },
      update: {},
      create: {
        id: params.borrower,
      },
    });
    
    // Create notification
    await notificationService.createNotification({
      userId: params.borrower,
      type: 'loan_created',
      title: 'Loan Created',
      message: `Your loan of ${this.formatSOL(dbLoan.solBorrowed)} SOL has been created`,
      loanId: loanPubkey, // Use the correct loanPubkey variable
    });
    
    // Emit websocket event
    websocketService.emit(WebSocketEvent.LOAN_CREATED, {
      loan: this.formatLoan(dbLoan),
      txSignature: params.txSignature,
    });
    
    return this.formatLoan(dbLoan);
  }

  // Helper function
  private formatSOL(lamports: string): string {
    return (BigInt(lamports) / BigInt(1e9)).toString();
  }

  async checkLiquidatableLoans(): Promise<string[]> {
    // Get all active loans
    const activeLoans = await prisma.loan.findMany({
      where: { status: LoanStatus.Active },
      include: { token: true },
    });
    
    const liquidatable: string[] = [];
    
    for (const loan of activeLoans) {
      // Check time-based liquidation
      if (new Date() > loan.dueAt) {
        liquidatable.push(loan.id);
        continue;
      }
      
      // Check price-based liquidation
      const currentPrice = await priceService.getCurrentPrice(loan.tokenMint);
      
      // Log values for debugging
      console.log(`Checking liquidation for loan ${loan.id}:`, {
        currentPrice: currentPrice.price,
        liquidationPrice: loan.liquidationPrice,
        tokenMint: loan.tokenMint
      });
      
      // Convert decimal prices to comparable numbers
      // Prices are stored as strings with decimal values
      const currentPriceNum = parseFloat(currentPrice.price);
      const liquidationPriceNum = parseFloat(loan.liquidationPrice);
      
      if (currentPriceNum <= liquidationPriceNum) {
        liquidatable.push(loan.id);
      }
    }
    
    return liquidatable;
  }
  
  // Helper method to find loan PDA from transaction logs/accounts
  private async findLoanPDAFromTransaction(
    txSignature: string, 
    borrower: string, 
    tokenMint: string
  ): Promise<string> {
    const client = await this.getClient();
    
    try {
      // Get transaction details
      const tx = await client.connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx || !tx.meta) {
        throw new Error('Transaction not found or not confirmed');
      }
      
      // Get protocol state to determine the loan index that was used
      const [protocolStatePDA] = client.getProtocolStatePDA();
      const protocolState = await (client.program.account as any).protocolState.fetch(protocolStatePDA);
      
      // The loan index used in the transaction would be totalLoansCreated - 1
      // (since totalLoansCreated was incremented after the loan was created)
      const loanIndex = new BN(protocolState.totalLoansCreated.toNumber() - 1);
      
      // Derive the loan PDA using the correct index
      const [loanPDA] = client.getLoanPDA(
        new PublicKey(borrower),
        new PublicKey(tokenMint),
        loanIndex
      );
      
      console.log('[LoanService] Derived loan PDA:', loanPDA.toString());
      return loanPDA.toString();
      
    } catch (error: any) {
      console.error('[LoanService] Failed to find loan PDA from transaction:', error.message);
      
      // Fallback: try scanning recent loans to find a match
      try {
        console.log('[LoanService] Attempting fallback: scanning recent loans...');
        // Get recent loans from database
        const allLoans = await prisma.loan.findMany({
          where: { 
            borrower: borrower,
            tokenMint: tokenMint,
            status: 'Active',
            createdAt: {
              gte: new Date(Date.now() - 5 * 60 * 1000) // Within 5 minutes
            }
          },
          orderBy: { createdAt: 'desc' }
        });
        
        const recentLoan = allLoans[0];
        
        if (recentLoan) {
          console.log('[LoanService] Found matching recent loan:', recentLoan.id);
          return recentLoan.id;
        }
      } catch (fallbackError: any) {
        console.error('[LoanService] Fallback search also failed:', fallbackError.message);
      }
      
      throw new Error('Could not find loan PDA from transaction. Please try again or contact support.');
    }
  }

  /**
   * Get all active loans for monitoring initialization
   */
  async getActiveLoans(): Promise<any[]> {
    return prisma.loan.findMany({
      where: { status: 'active' },
      include: { token: true },
    });
  }
}

export const loanService = new LoanService();