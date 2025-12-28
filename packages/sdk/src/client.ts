import { Connection, PublicKey, Keypair, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, Program, BN, Idl, Wallet } from '@coral-xyz/anchor';
import {
  ProtocolState,
  TokenConfig,
  Loan,
  LoanStatus,
  CreateLoanParams,
  LoanTermsParams,
  LoanTerms,
} from '@memecoin-lending/types';
import { PROGRAM_ID } from '@memecoin-lending/config';
import * as instructions from './instructions';
import * as accounts from './accounts';
import * as pda from './pda';
import { calculateLoanTerms } from './utils';

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

  constructor(
    connection: Connection,
    wallet: AnchorWallet,
    programId: PublicKey = PROGRAM_ID,
    idl?: Idl
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
    // This would fetch from the pool
    // For now, return a placeholder
    return new BN(1000000); // $1 with 6 decimals
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
  async isLoanLiquidatable(loanPubkey: PublicKey): Promise<boolean> {
    const loan = await this.getLoan(loanPubkey);
    if (!loan || loan.status !== LoanStatus.Active) {
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > loan.dueAt) {
      return true;
    }

    const currentPrice = await this.getCurrentPrice(new PublicKey(loan.tokenMint));
    if (currentPrice.lte(new BN(loan.liquidationPrice))) {
      return true;
    }

    return false;
  }
}