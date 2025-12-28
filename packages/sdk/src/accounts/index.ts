import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  ProtocolState,
  TokenConfig,
  Loan,
  LoanStatus,
  TokenTier,
  PoolType,
  LoanAccount,
} from '@memecoin-lending/types';
import * as pda from '../pda';

export async function getProtocolState(program: Program): Promise<ProtocolState> {
  const [protocolStatePDA] = pda.getProtocolStatePDA(program.programId);
  
  // Mock implementation - in real implementation, this would fetch from blockchain
  return {
    admin: '11111111111111111111111111111111',
    buybackWallet: '11111111111111111111111111111111',
    operationsWallet: '11111111111111111111111111111111',
    paused: false,
    totalLoansCreated: '0',
    totalSolBorrowed: '0',
    totalInterestEarned: '0',
    activeLoansCount: '0',
    protocolFeeBps: 100,
    treasuryFeeBps: 9000,
    buybackFeeBps: 500,
    operationsFeeBps: 400,
  };
}

export async function getTokenConfig(
  program: Program,
  mint: PublicKey
): Promise<TokenConfig | null> {
  const [tokenConfigPDA] = pda.getTokenConfigPDA(mint, program.programId);
  
  // Mock implementation - in real implementation, this would fetch from blockchain
  return {
    pubkey: tokenConfigPDA.toString(),
    mint: mint.toString(),
    tier: TokenTier.Bronze,
    enabled: true,
    poolAddress: '11111111111111111111111111111111',
    poolType: PoolType.Raydium,
    ltvBps: 7000,
    interestRateBps: 1000,
    liquidationBonusBps: 500,
    minLoanAmount: '100000000',
    maxLoanAmount: '10000000000',
    activeLoansCount: '0',
    totalVolume: '0',
  };
}

export async function getLoan(
  program: Program,
  loanPubkey: PublicKey
): Promise<Loan | null> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return {
    pubkey: loanPubkey.toString(),
    borrower: '11111111111111111111111111111111',
    tokenMint: 'So11111111111111111111111111111111111111112',
    collateralAmount: '1000000000',
    solBorrowed: '700000000',
    entryPrice: '100000000',
    liquidationPrice: '85000000',
    interestRateBps: 1000,
    createdAt: Date.now() / 1000,
    dueAt: (Date.now() / 1000) + (30 * 24 * 60 * 60),
    status: LoanStatus.Active,
    index: 0,
  };
}

export async function getActiveLoans(program: Program): Promise<Loan[]> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return [];
}

export async function getLoansByBorrower(
  program: Program,
  borrower: PublicKey
): Promise<Loan[]> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return [];
}

export async function getLoansByToken(
  program: Program,
  mint: PublicKey
): Promise<Loan[]> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return [];
}

export async function getLoansByStatus(
  program: Program,
  status: LoanStatus
): Promise<Loan[]> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return [];
}

export async function getAllTokenConfigs(program: Program): Promise<TokenConfig[]> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return [];
}

export async function getWhitelistedTokens(program: Program): Promise<TokenConfig[]> {
  // Mock implementation - in real implementation, this would fetch from blockchain
  return [];
}

// Helper to parse pool type from on-chain data
export function parsePoolType(poolTypeData: any): PoolType {
  if (poolTypeData.raydium) return PoolType.Raydium;
  if (poolTypeData.orca) return PoolType.Orca;
  if (poolTypeData.pumpfun) return PoolType.Pumpfun;
  if (poolTypeData.pumpswap) return PoolType.PumpSwap;
  return PoolType.Raydium; // default
}

// Helper to convert pool type to on-chain format
export function poolTypeToNumber(poolType: PoolType): number {
  switch (poolType) {
    case PoolType.Raydium: return 0;
    case PoolType.Orca: return 1;
    case PoolType.Pumpfun: return 2;
    case PoolType.PumpSwap: return 3;
    default: return 0;
  }
}