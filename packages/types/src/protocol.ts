import { PublicKey } from '@solana/web3.js';

export enum TokenTier {
  Bronze = 'bronze',
  Silver = 'silver',
  Gold = 'gold',
}

export enum LoanStatus {
  Active = 'active',
  Repaid = 'repaid',
  LiquidatedTime = 'liquidatedTime',
  LiquidatedPrice = 'liquidatedPrice',
}

export interface ProtocolState {
  admin: string;
  paused: boolean;
  totalLoansCreated: string;
  totalSolBorrowed: string;
  totalInterestEarned: string;
  treasuryBalance: string;
}

export interface TokenConfig {
  pubkey: string;
  mint: string;
  tier: TokenTier;
  enabled: boolean;
  poolAddress: string;
  ltvBps: number;
  interestRateBps: number;
  liquidationBonusBps: number;
  minLoanAmount: string;
  maxLoanAmount: string;
}

export interface Loan {
  pubkey: string;
  borrower: string;
  tokenMint: string;
  collateralAmount: string;
  solBorrowed: string;
  entryPrice: string;
  liquidationPrice: string;
  interestRateBps: number;
  createdAt: number;
  dueAt: number;
  status: LoanStatus;
  index: number;
}

export interface LoanAccount {
  borrower: PublicKey;
  tokenMint: PublicKey;
  collateralAmount: bigint;
  solBorrowed: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
  interestRateBps: number;
  createdAt: bigint;
  dueAt: bigint;
  status: {
    active?: {};
    repaid?: {};
    liquidatedTime?: {};
    liquidatedPrice?: {};
  };
  index: bigint;
}

export interface CreateLoanParams {
  tokenMint: string;
  collateralAmount: string;
  durationSeconds: number;
  borrower?: string;
}

export interface LoanTermsParams {
  tokenMint: string;
  collateralAmount: string;
  durationSeconds: number;
  currentPrice: string;
  tokenConfig: TokenConfig;
}

export interface LoanTerms {
  solAmount: string;
  interestRate: number;
  totalOwed: string;
  liquidationPrice: string;
  ltv: number;
}