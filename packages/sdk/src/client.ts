import { Connection, PublicKey, Keypair, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, Program, Idl, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  ProtocolState,
  TokenConfig,
  Loan,
  LoanStatus,
  CreateLoanParams,
  LoanTermsParams,
  LoanTerms,
} from '@memecoin-lending/types';
import { PROGRAM_ID, API_ENDPOINTS } from '@memecoin-lending/config';
import * as instructions from './instructions';
import * as accounts from './accounts';
import * as pda from './pda';
import { calculateLoanTerms } from './utils';
import { PriceClient, PriceData } from './price';

export interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction: any;
  signAllTransactions: any;
}

export class MemecoinLendingClient {
  readonly connection: Connection;
  readonly wallet: AnchorWallet;
  readonly programId: PublicKey;
  readonly provider: AnchorProvider;
  readonly program: Program;
  readonly priceClient: PriceClient;

  constructor(
    connection: Connection,
    wallet: AnchorWallet,
    programId: PublicKey = PROGRAM_ID,
    idl?: Idl,
    apiEndpoint?: string
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = programId;
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    
    if (!idl) {
      throw new Error('IDL is required for SDK initialization');
    }
    
    this.program = new Program(idl, this.provider);
    this.priceClient = new PriceClient(apiEndpoint);
  }

  // PDA derivations
  getProtocolStatePDA(): [PublicKey, number] {
    return pda.getProtocolStatePDA(this.programId);
  }

  getTreasuryPDA(): [PublicKey, number] {
    return pda.getTreasuryPDA(this.programId);
  }

  getTokenConfigPDA(mint: PublicKey): [PublicKey, number] {
    return pda.getTokenConfigPDA(mint, this.programId);
  }

  getLoanPDA(borrower: PublicKey, mint: PublicKey, index: BN): [PublicKey, number] {
    return pda.getLoanPDA(borrower, mint, index, this.programId);
  }

  // Instructions
  async initializeProtocol(
    admin?: PublicKey,
    buybackWallet?: PublicKey,
    operationsWallet?: PublicKey
  ): Promise<TransactionSignature> {
    return instructions.initializeProtocol(
      this.program,
      admin || this.wallet.publicKey,
      buybackWallet || this.wallet.publicKey,
      operationsWallet || this.wallet.publicKey
    );
  }

  async whitelistToken(params: {
    mint: PublicKey;
    tier: number;
    poolAddress: PublicKey;
    poolType: number;
    minLoanAmount: BN;
    maxLoanAmount: BN;
  }): Promise<TransactionSignature> {
    return instructions.whitelistToken(this.program, params);
  }

  async createLoan(params: CreateLoanParams): Promise<TransactionSignature> {
    const mint = new PublicKey(params.tokenMint);
    const borrower = params.borrower 
      ? new PublicKey(params.borrower) 
      : this.wallet.publicKey;
    
    return instructions.createLoan(this.program, {
      tokenMint: mint,
      collateralAmount: new BN(params.collateralAmount),
      durationSeconds: new BN(params.durationSeconds),
      borrower,
    });
  }

  async repayLoan(loanPubkey: PublicKey): Promise<TransactionSignature> {
    return instructions.repayLoan(this.program, loanPubkey);
  }

  async liquidate(loanPubkey: PublicKey): Promise<TransactionSignature> {
    return instructions.liquidate(this.program, loanPubkey);
  }

  async updateTokenConfig(params: {
    mint: PublicKey;
    enabled?: boolean;
    ltvBps?: number;
    interestRateBps?: number;
  }): Promise<TransactionSignature> {
    return instructions.updateTokenConfig(this.program, params);
  }

  async pauseProtocol(): Promise<TransactionSignature> {
    return instructions.pauseProtocol(this.program);
  }

  async resumeProtocol(): Promise<TransactionSignature> {
    return instructions.resumeProtocol(this.program);
  }

  async withdrawTreasury(amount: BN): Promise<TransactionSignature> {
    return instructions.withdrawTreasury(this.program, amount);
  }

  async fundTreasury(amount: BN): Promise<TransactionSignature> {
    return instructions.fundTreasury(this.program, amount);
  }

  async updateFees(params: {
    protocolFeeBps?: number;
    treasuryFeeBps?: number;
    buybackFeeBps?: number;
    operationsFeeBps?: number;
  }): Promise<TransactionSignature> {
    return instructions.updateFees(this.program, params);
  }

  async updateWallets(params: {
    newAdmin?: PublicKey;
    newBuybackWallet?: PublicKey;
    newOperationsWallet?: PublicKey;
  }): Promise<TransactionSignature> {
    return instructions.updateWallets(this.program, params);
  }

  // Account fetchers
  async getProtocolState(): Promise<ProtocolState> {
    return accounts.getProtocolState(this.program);
  }

  async getTokenConfig(mint: PublicKey): Promise<TokenConfig | null> {
    return accounts.getTokenConfig(this.program, mint);
  }

  async getLoan(loanPubkey: PublicKey): Promise<Loan | null> {
    return accounts.getLoan(this.program, loanPubkey);
  }

  async getActiveLoans(): Promise<Loan[]> {
    return accounts.getActiveLoans(this.program);
  }

  async getLoansByBorrower(borrower: PublicKey): Promise<Loan[]> {
    return accounts.getLoansByBorrower(this.program, borrower);
  }

  async getLoansByToken(mint: PublicKey): Promise<Loan[]> {
    return accounts.getLoansByToken(this.program, mint);
  }

  async getLoansByStatus(status: LoanStatus): Promise<Loan[]> {
    return accounts.getLoansByStatus(this.program, status);
  }

  async getWhitelistedTokens(): Promise<TokenConfig[]> {
    return accounts.getWhitelistedTokens(this.program);
  }

  // Utility methods
  calculateLoanTerms(params: LoanTermsParams): LoanTerms {
    return calculateLoanTerms(params);
  }

  async getCurrentPrice(mint: PublicKey): Promise<BN> {
    const priceData = await this.priceClient.getPrice(mint.toString());
    if (!priceData) {
      throw new Error(`Price not available for token ${mint.toString()}`);
    }
    
    // Return price in lamports (SOL price) or convert USD to lamports using SOL price
    if (priceData.solPrice) {
      // Convert SOL price to lamports (multiply by 1e9)
      return new BN(Math.round(priceData.solPrice * 1e9));
    } else {
      // Convert USD price to SOL, then to lamports
      const solToLamports = await this.priceClient.convertUsdToSol(priceData.usdPrice);
      if (!solToLamports) {
        throw new Error('Unable to convert USD price to SOL');
      }
      return new BN(Math.round(solToLamports * 1e9));
    }
  }

  // Price-related methods
  async getTokenPrice(mint: PublicKey): Promise<PriceData | null> {
    return this.priceClient.getPrice(mint.toString());
  }

  async getTokenPrices(mints: PublicKey[]): Promise<Map<string, PriceData>> {
    const mintStrings = mints.map(mint => mint.toString());
    return this.priceClient.getPrices(mintStrings);
  }

  async getSolPrice(): Promise<number | null> {
    return this.priceClient.getSolPrice();
  }

  async getAllTokenPrices(): Promise<Map<string, PriceData>> {
    return this.priceClient.getAllTokenPrices();
  }

  async getTokenValueUsd(mint: PublicKey, amount: BN, decimals?: number): Promise<number | null> {
    return this.priceClient.getTokenValueUsd(mint.toString(), amount, decimals);
  }

  async getTokenValueSol(mint: PublicKey, amount: BN, decimals?: number): Promise<number | null> {
    return this.priceClient.getTokenValueSol(mint.toString(), amount, decimals);
  }

  async estimateLoan(params: CreateLoanParams): Promise<LoanTerms> {
    const mint = new PublicKey(params.tokenMint);
    const tokenConfig = await this.getTokenConfig(mint);
    
    if (!tokenConfig) {
      throw new Error('Token not whitelisted');
    }

    const currentPrice = await this.getCurrentPrice(mint);
    
    return this.calculateLoanTerms({
      tokenMint: params.tokenMint,
      collateralAmount: params.collateralAmount,
      durationSeconds: params.durationSeconds,
      currentPrice: currentPrice.toString(),
      tokenConfig,
    });
  }

  // Helper to check if a loan is liquidatable
  async isLoanLiquidatable(loanPubkey: PublicKey): Promise<{
    liquidatable: boolean;
    reason?: 'time' | 'price';
    currentPrice?: number;
    liquidationPrice?: number;
    timeRemaining?: number;
  }> {
    const loan = await this.getLoan(loanPubkey);
    if (!loan || loan.status !== LoanStatus.Active) {
      return { liquidatable: false };
    }

    // Check time-based liquidation
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > loan.dueAt) {
      return { 
        liquidatable: true, 
        reason: 'time',
        timeRemaining: 0
      };
    }

    // Check price-based liquidation
    try {
      const priceData = await this.getTokenPrice(new PublicKey(loan.tokenMint));
      if (priceData?.solPrice) {
        const currentPriceLamports = priceData.solPrice * 1e9; // Convert to lamports
        const liquidationPriceLamports = parseFloat(loan.liquidationPrice);
        
        if (currentPriceLamports <= liquidationPriceLamports) {
          return { 
            liquidatable: true, 
            reason: 'price',
            currentPrice: currentPriceLamports,
            liquidationPrice: liquidationPriceLamports,
            timeRemaining: loan.dueAt - currentTime
          };
        }

        return { 
          liquidatable: false,
          currentPrice: currentPriceLamports,
          liquidationPrice: liquidationPriceLamports,
          timeRemaining: loan.dueAt - currentTime
        };
      }
    } catch (error) {
      console.error('Error checking price liquidation:', error);
    }

    return { 
      liquidatable: false,
      timeRemaining: loan.dueAt - currentTime
    };
  }

  // Enhanced liquidation risk analysis
  async analyzeLiquidationRisk(loanPubkey: PublicKey): Promise<{
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    currentLtv: number;
    liquidationLtv: number;
    priceDropToLiquidation: number;
    timeToExpiry: number;
    recommendations: string[];
  } | null> {
    const loan = await this.getLoan(loanPubkey);
    if (!loan || loan.status !== LoanStatus.Active) {
      return null;
    }

    const tokenConfig = await this.getTokenConfig(new PublicKey(loan.tokenMint));
    if (!tokenConfig) {
      return null;
    }

    const riskAnalysis = await this.priceClient.checkLiquidationRisk(
      loan.tokenMint,
      new BN(loan.collateralAmount),
      new BN(loan.solBorrowed),
      tokenConfig.ltvBps,
      9 // Assuming 9 decimals for most tokens
    );

    if (!riskAnalysis) {
      return null;
    }

    const timeToExpiry = loan.dueAt - Math.floor(Date.now() / 1000);
    const priceDropToLiquidation = ((riskAnalysis.currentLtv - riskAnalysis.liquidationLtv) / riskAnalysis.currentLtv) * 100;

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    const recommendations: string[] = [];

    if (riskAnalysis.isAtRisk) {
      riskLevel = 'critical';
      recommendations.push('Immediate action required - loan is at liquidation risk');
      recommendations.push('Add more collateral or repay loan immediately');
    } else if (riskAnalysis.currentLtv > riskAnalysis.liquidationLtv * 0.9) {
      riskLevel = 'high';
      recommendations.push('High risk - consider adding collateral');
      recommendations.push(`Price needs to drop only ${priceDropToLiquidation.toFixed(2)}% for liquidation`);
    } else if (riskAnalysis.currentLtv > riskAnalysis.liquidationLtv * 0.75) {
      riskLevel = 'medium';
      recommendations.push('Monitor closely - moderate risk level');
    } else {
      riskLevel = 'low';
      recommendations.push('Low risk - loan is healthy');
    }

    if (timeToExpiry < 24 * 60 * 60) { // Less than 24 hours
      recommendations.push('Loan expires soon - consider repaying or extending');
    }

    return {
      riskLevel,
      currentLtv: riskAnalysis.currentLtv,
      liquidationLtv: riskAnalysis.liquidationLtv,
      priceDropToLiquidation,
      timeToExpiry,
      recommendations,
    };
  }
}