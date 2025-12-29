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
import { websocketService } from '../websocket/index.js';
import { PROGRAM_ID, getNetworkConfig, getCurrentNetwork } from '@memecoin-lending/config';



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
    
    // Get token config from chain
    const mint = new PublicKey(params.tokenMint);
    const [tokenConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_config'), mint.toBuffer()],
      client.program.programId
    );
    
    console.log('[LoanService] TokenConfig PDA:', tokenConfigPDA.toString());
    
    let tokenConfig: TokenConfig;
    try {
      const account = await (client.program.account as any).tokenConfig.fetch(tokenConfigPDA);
      console.log('[LoanService] Account fetched:', account);
      
      // Convert to TokenConfig format
      tokenConfig = {
        pubkey: tokenConfigPDA.toString(),
        mint: account.mint.toString(),
        tier: account.tier.bronze ? TokenTier.Bronze : account.tier.silver ? TokenTier.Silver : TokenTier.Gold,
        enabled: account.enabled,
        poolAddress: account.poolAddress.toString(),
        poolType: account.poolType.pumpfun ? PoolType.Pumpfun : account.poolType.raydium ? PoolType.Raydium : PoolType.Orca,
        ltvBps: account.ltvBps,
        liquidationBonusBps: account.liquidationBonusBps,
        minLoanAmount: account.minLoanAmount.toString(),
        maxLoanAmount: account.maxLoanAmount.toString(),
        activeLoansCount: account.activeLoansCount.toString(),
        totalVolume: account.totalVolume.toString(),
      };
    } catch (error: any) {
      console.error('[LoanService] Fetch error:', error.message);
      throw new Error('Token config not found on-chain');
    }
    
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
      protocolFeeRate: loanTerms.protocolFeeRate, // Always 1%
      totalOwed: loanTerms.totalOwed,
      liquidationPrice: loanTerms.liquidationPrice,
      ltv: loanTerms.ltv,
      fees: {
        protocolFee: (parseFloat(loanTerms.solAmount) * 0.01).toString(),
        interest: '0', // No interest anymore
      },
    };
  }
  
  async createLoan(params: CreateLoanRequest & { borrower: string }): Promise<{ transaction: string }> {
    const client = await this.getClient();
    
    // Import tokenVerificationService dynamically to avoid circular dependency
    const { tokenVerificationService } = await import('./token-verification.service.js');
    
    // First verify and potentially auto-whitelist the token
    console.log('[LoanService] Verifying token for loan creation:', params.tokenMint.substring(0, 8) + '...');
    const verification = await tokenVerificationService.verifyToken(params.tokenMint);
    
    if (!verification.isValid) {
      throw new Error(verification.reason || 'Token not eligible for loans');
    }
    
    // Estimate loan first to validate parameters (will recheck token but that's ok for safety)
    await this.estimateLoan(params);
    
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
    
    // Serialize and return (unsigned)
    const serializedTx = tx.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false 
    }).toString('base64');
    
    return { transaction: serializedTx };
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
    
    // Get token configuration to check pool type
    const tokenConfig = await prisma.tokenConfig.findUnique({
      where: { tokenMint: dbLoan.tokenMint },
    });
    
    if (!tokenConfig) {
      throw new Error('Token configuration not found');
    }
    
    let txSignature: string;
    
    try {
      // Execute liquidation based on pool type
      if (tokenConfig.poolType === PoolType.Pumpfun) {
        console.log(`🔥 Liquidating PumpFun loan ${loanPubkey} via bonding curve`);
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
          150 // 1.5% slippage tolerance
        );
      }
    } catch (error) {
      console.error(`Failed to liquidate loan ${loanPubkey}:`, error);
      throw new Error(`Liquidation failed: ${error.message}`);
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
        const allLoans = await client.getAllLoans();
        
        // Find loan that matches borrower and token mint, created recently
        const recentLoan = allLoans
          .filter(loan => 
            loan.borrower === borrower && 
            loan.tokenMint === tokenMint &&
            Math.abs(loan.createdAt - Math.floor(Date.now() / 1000)) < 300 // Within 5 minutes
          )
          .sort((a, b) => b.createdAt - a.createdAt)[0]; // Most recent first
        
        if (recentLoan) {
          console.log('[LoanService] Found matching recent loan:', recentLoan.pubkey);
          return recentLoan.pubkey;
        }
      } catch (fallbackError: any) {
        console.error('[LoanService] Fallback search also failed:', fallbackError.message);
      }
      
      throw new Error('Could not find loan PDA from transaction. Please try again or contact support.');
    }
  }
}

export const loanService = new LoanService();