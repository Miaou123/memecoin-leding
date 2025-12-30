import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
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
  
  const account = await (program.account as any).protocolState.fetch(protocolStatePDA);
  
  return {
    admin: account.admin.toString(),
    buybackWallet: account.buybackWallet.toString(),
    operationsWallet: account.operationsWallet.toString(),
    paused: account.paused,
    totalLoansCreated: account.totalLoansCreated.toString(),
    totalSolBorrowed: account.totalSolBorrowed.toString(),
    totalFeesEarned: account.totalFeesEarned.toString(),
    activeLoansCount: account.activeLoansCount.toString(),
    protocolFeeBps: account.protocolFeeBps,
    treasuryFeeBps: account.treasuryFeeBps,
    buybackFeeBps: account.buybackFeeBps,
    operationsFeeBps: account.operationsFeeBps,
    treasuryBalance: account.treasuryBalance?.toString() || '0',
  };
}

export async function getTokenConfig(
  program: Program,
  mint: PublicKey
): Promise<TokenConfig | null> {
  const [tokenConfigPDA] = pda.getTokenConfigPDA(mint, program.programId);
  
  try {
    const account = await (program.account as any).tokenConfig.fetch(tokenConfigPDA);
    
    return {
      pubkey: tokenConfigPDA.toString(),
      mint: account.mint.toString(),
      tier: parseTier(account.tier),
      enabled: account.enabled,
      poolAddress: account.poolAddress.toString(),
      poolType: parsePoolType(account.poolType),
      ltvBps: account.ltvBps,
      minLoanAmount: account.minLoanAmount.toString(),
      maxLoanAmount: account.maxLoanAmount.toString(),
      activeLoansCount: account.activeLoansCount.toString(),
      totalVolume: account.totalVolume.toString(),
    };
  } catch (error) {
    // Account doesn't exist
    return null;
  }
}

export async function getLoan(
  program: Program,
  loanPubkey: PublicKey
): Promise<Loan | null> {
  try {
    const account = await (program.account as any).loan.fetch(loanPubkey);
    
    return {
      pubkey: loanPubkey.toString(),
      borrower: account.borrower.toString(),
      tokenMint: account.tokenMint.toString(),
      collateralAmount: account.collateralAmount.toString(),
      solBorrowed: account.solBorrowed.toString(),
      entryPrice: account.entryPrice.toString(),
      liquidationPrice: account.liquidationPrice.toString(),
      createdAt: account.createdAt.toNumber(),
      dueAt: account.dueAt.toNumber(),
      status: parseLoanStatus(account.status),
      index: account.index.toNumber(),
    };
  } catch (error) {
    return null;
  }
}

export async function getActiveLoans(program: Program): Promise<Loan[]> {
  try {
    const accounts = await (program.account as any).loan.all();
    return accounts
      .map((acc: any) => ({
        pubkey: acc.publicKey.toString(),
        borrower: acc.account.borrower.toString(),
        tokenMint: acc.account.tokenMint.toString(),
        collateralAmount: acc.account.collateralAmount.toString(),
        solBorrowed: acc.account.solBorrowed.toString(),
        entryPrice: acc.account.entryPrice.toString(),
        liquidationPrice: acc.account.liquidationPrice.toString(),
        createdAt: acc.account.createdAt.toNumber(),
        dueAt: acc.account.dueAt.toNumber(),
        status: parseLoanStatus(acc.account.status),
        index: acc.account.index.toNumber(),
      }))
      .filter((loan: Loan) => loan.status === LoanStatus.Active);
  } catch (error) {
    return [];
  }
}

export async function getLoansByBorrower(
  program: Program,
  borrower: PublicKey
): Promise<Loan[]> {
  try {
    const accounts = await (program.account as any).loan.all([
      { memcmp: { offset: 8, bytes: borrower.toBase58() } }
    ]);
    return accounts.map((acc: any) => ({
      pubkey: acc.publicKey.toString(),
      borrower: acc.account.borrower.toString(),
      tokenMint: acc.account.tokenMint.toString(),
      collateralAmount: acc.account.collateralAmount.toString(),
      solBorrowed: acc.account.solBorrowed.toString(),
      entryPrice: acc.account.entryPrice.toString(),
      liquidationPrice: acc.account.liquidationPrice.toString(),
      createdAt: acc.account.createdAt.toNumber(),
      dueAt: acc.account.dueAt.toNumber(),
      status: parseLoanStatus(acc.account.status),
      index: acc.account.index.toNumber(),
    }));
  } catch (error) {
    return [];
  }
}

export async function getLoansByToken(
  program: Program,
  mint: PublicKey
): Promise<Loan[]> {
  try {
    const accounts = await (program.account as any).loan.all([
      { memcmp: { offset: 40, bytes: mint.toBase58() } }
    ]);
    return accounts.map((acc: any) => ({
      pubkey: acc.publicKey.toString(),
      borrower: acc.account.borrower.toString(),
      tokenMint: acc.account.tokenMint.toString(),
      collateralAmount: acc.account.collateralAmount.toString(),
      solBorrowed: acc.account.solBorrowed.toString(),
      entryPrice: acc.account.entryPrice.toString(),
      liquidationPrice: acc.account.liquidationPrice.toString(),
      createdAt: acc.account.createdAt.toNumber(),
      dueAt: acc.account.dueAt.toNumber(),
      status: parseLoanStatus(acc.account.status),
      index: acc.account.index.toNumber(),
    }));
  } catch (error) {
    return [];
  }
}

export async function getLoansByStatus(
  program: Program,
  status: LoanStatus
): Promise<Loan[]> {
  const allLoans = await getActiveLoans(program);
  return allLoans.filter(loan => loan.status === status);
}

export async function getAllTokenConfigs(program: Program): Promise<TokenConfig[]> {
  try {
    const accounts = await (program.account as any).tokenConfig.all();
    return accounts.map((acc: any) => ({
      pubkey: acc.publicKey.toString(),
      mint: acc.account.mint.toString(),
      tier: parseTier(acc.account.tier),
      enabled: acc.account.enabled,
      poolAddress: acc.account.poolAddress.toString(),
      poolType: parsePoolType(acc.account.poolType),
      ltvBps: acc.account.ltvBps,
      minLoanAmount: acc.account.minLoanAmount.toString(),
      maxLoanAmount: acc.account.maxLoanAmount.toString(),
      activeLoansCount: acc.account.activeLoansCount.toString(),
      totalVolume: acc.account.totalVolume.toString(),
    }));
  } catch (error) {
    return [];
  }
}

export async function getWhitelistedTokens(program: Program): Promise<TokenConfig[]> {
  const allConfigs = await getAllTokenConfigs(program);
  return allConfigs.filter(config => config.enabled);
}

// Helper to parse tier from on-chain data
export function parseTier(tierData: any): TokenTier {
  if (tierData.bronze) return TokenTier.Bronze;
  if (tierData.silver) return TokenTier.Silver;
  if (tierData.gold) return TokenTier.Gold;
  return TokenTier.Bronze;
}

// Helper to parse pool type from on-chain data
export function parsePoolType(poolTypeData: any): PoolType {
  if (poolTypeData.raydium) return PoolType.Raydium;
  if (poolTypeData.orca) return PoolType.Orca;
  if (poolTypeData.pumpfun) return PoolType.Pumpfun;
  if (poolTypeData.pumpswap) return PoolType.PumpSwap;
  return PoolType.Raydium;
}

// Helper to parse loan status from on-chain data
export function parseLoanStatus(statusData: any): LoanStatus {
  if (statusData.active) return LoanStatus.Active;
  if (statusData.repaid) return LoanStatus.Repaid;
  if (statusData.liquidatedTime) return LoanStatus.LiquidatedTime;
  if (statusData.liquidatedPrice) return LoanStatus.LiquidatedPrice;
  return LoanStatus.Active;
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