import { PublicKey } from '@solana/web3.js';

export enum PoolType {
  Raydium = 'raydium',
  Orca = 'orca',
  Pumpfun = 'pumpfun',
  PumpSwap = 'pumpswap',
}

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
  buybackWallet: string;
  operationsWallet: string;
  paused: boolean;
  totalLoansCreated: string;
  totalSolBorrowed: string;
  totalFeesEarned: string;
  activeLoansCount: string;
  protocolFeeBps: number;
  treasuryFeeBps: number;
  buybackFeeBps: number;
  operationsFeeBps: number;
  treasuryBalance: string;
}

export interface TokenConfig {
  pubkey: string;
  mint: string;
  tier: TokenTier;
  enabled: boolean;
  poolAddress: string;
  poolType: PoolType;
  ltvBps: number;
  minLoanAmount: string;
  maxLoanAmount: string;
  activeLoansCount: string;
  totalVolume: string;
  isProtocolToken: boolean;
}

export interface Loan {
  pubkey: string;
  borrower: string;
  tokenMint: string;
  collateralAmount: string;
  solBorrowed: string;
  entryPrice: string;
  liquidationPrice: string;
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
  tokenDecimals?: number; // Default to 6 for PumpFun tokens
}

export interface LoanTerms {
  solAmount: string;
  protocolFeeBps: number; // Always 200 (2%)
  totalOwed: string;
  liquidationPrice: string;
  ltv: number;           // Effective LTV after duration adjustment
  baseLtv?: number;      // Base LTV from tier
  ltvModifier?: string;  // Display string like "+25%" or "-12.5%"
}