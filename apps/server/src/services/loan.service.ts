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
import { MemecoinLendingClient, buildCreateLoanTransaction } from '@memecoin-lending/sdk';
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
      interestRateBps: loan.interestRateBps,
      createdAt: Math.floor(loan.createdAt.getTime() / 1000),
      dueAt: Math.floor(loan.dueAt.getTime() / 1000),
      status: loan.status as LoanStatus,
      index: 0, // TODO: Store index in DB
    };
  }
  
  async estimateLoan(params: CreateLoanRequest): Promise<LoanEstimate> {
    const client = await this.getClient();
    
    console.log('[LoanService] Program ID:', client.program.programId.toString());
    
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
        interestRateBps: account.interestRateBps,
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
      interestRate: loanTerms.interestRate,
      totalOwed: loanTerms.totalOwed,
      liquidationPrice: loanTerms.liquidationPrice,
      ltv: loanTerms.ltv,
      fees: {
        protocolFee: '0',
        interest: '0',
      },
    };
  }
  
  async createLoan(params: CreateLoanRequest & { borrower: string }): Promise<{ transaction: string }> {
    const client = await this.getClient();
    
    // Estimate loan first to validate parameters
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
  
  async liquidateLoan(loanPubkey: string, liquidator: string): Promise<Loan> {
    const client = await this.getClient();
    
    // Check if loan is liquidatable
    const isLiquidatable = await client.isLoanLiquidatable(new PublicKey(loanPubkey));
    if (!isLiquidatable) {
      throw new Error('Loan is not liquidatable');
    }
    
    // Liquidate loan on-chain
    const txSignature = await client.liquidate(new PublicKey(loanPubkey));
    
    // Determine liquidation reason
    const dbLoan = await prisma.loan.findUnique({
      where: { id: loanPubkey },
    });
    
    if (!dbLoan) {
      throw new Error('Loan not found');
    }
    
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
      txSignature,
    });
    
    return this.formatLoan(updatedLoan);
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
      const currentPriceBN = new BN(currentPrice.price);
      const liquidationPriceBN = new BN(loan.liquidationPrice);
      
      if (currentPriceBN.lte(liquidationPriceBN)) {
        liquidatable.push(loan.id);
      }
    }
    
    return liquidatable;
  }
}

export const loanService = new LoanService();