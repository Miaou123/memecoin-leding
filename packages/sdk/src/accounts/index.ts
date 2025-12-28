import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  ProtocolState,
  TokenConfig,
  Loan,
  LoanStatus,
  TokenTier,
  LoanAccount,
} from '@memecoin-lending/types';
import * as pda from '../pda';

export async function getProtocolState(program: Program): Promise<ProtocolState> {
  const [protocolStatePDA] = pda.getProtocolStatePDA(program.programId);
  const state = await program.account.protocolState.fetch(protocolStatePDA);
  
  return {
    admin: state.admin.toString(),
    paused: state.paused,
    totalLoansCreated: state.totalLoansCreated.toString(),
    totalSolBorrowed: state.totalSolBorrowed.toString(),
    totalInterestEarned: state.totalInterestEarned.toString(),
    treasuryBalance: state.treasuryBalance.toString(),
  };
}

export async function getTokenConfig(
  program: Program,
  mint: PublicKey
): Promise<TokenConfig | null> {
  const [tokenConfigPDA] = pda.getTokenConfigPDA(mint, program.programId);
  
  try {
    const config = await program.account.tokenConfig.fetch(tokenConfigPDA);
    return {
      pubkey: tokenConfigPDA.toString(),
      mint: config.mint.toString(),
      tier: convertTier(config.tier),
      enabled: config.enabled,
      poolAddress: config.poolAddress.toString(),
      ltvBps: config.ltvBps,
      interestRateBps: config.interestRateBps,
      liquidationBonusBps: config.liquidationBonusBps,
      minLoanAmount: config.minLoanAmount.toString(),
      maxLoanAmount: config.maxLoanAmount.toString(),
    };
  } catch {
    return null;
  }
}

export async function getLoan(
  program: Program,
  loanPubkey: PublicKey
): Promise<Loan | null> {
  try {
    const loan = await program.account.loan.fetch(loanPubkey);
    return convertLoanAccount(loan, loanPubkey);
  } catch {
    return null;
  }
}

export async function getActiveLoans(program: Program): Promise<Loan[]> {
  const loans = await program.account.loan.all([
    {
      memcmp: {
        offset: 8 + 32 + 32 + 8 + 8 + 8 + 8 + 2 + 8 + 8, // Offset to status field
        bytes: '1', // Active status
      },
    },
  ]);
  
  return loans.map(({ pubkey, account }) => convertLoanAccount(account, pubkey));
}

export async function getLoansByBorrower(
  program: Program,
  borrower: PublicKey
): Promise<Loan[]> {
  const loans = await program.account.loan.all([
    {
      memcmp: {
        offset: 8, // Offset to borrower field (after discriminator)
        bytes: borrower.toBase58(),
      },
    },
  ]);
  
  return loans.map(({ pubkey, account }) => convertLoanAccount(account, pubkey));
}

export async function getLoansByToken(
  program: Program,
  mint: PublicKey
): Promise<Loan[]> {
  const loans = await program.account.loan.all([
    {
      memcmp: {
        offset: 8 + 32, // Offset to tokenMint field
        bytes: mint.toBase58(),
      },
    },
  ]);
  
  return loans.map(({ pubkey, account }) => convertLoanAccount(account, pubkey));
}

export async function getLoansByStatus(
  program: Program,
  status: LoanStatus
): Promise<Loan[]> {
  const statusByte = getStatusByte(status);
  const loans = await program.account.loan.all([
    {
      memcmp: {
        offset: 8 + 32 + 32 + 8 + 8 + 8 + 8 + 2 + 8 + 8, // Offset to status field
        bytes: statusByte,
      },
    },
  ]);
  
  return loans.map(({ pubkey, account }) => convertLoanAccount(account, pubkey));
}

export async function getWhitelistedTokens(program: Program): Promise<TokenConfig[]> {
  const configs = await program.account.tokenConfig.all();
  
  return configs
    .filter(({ account }) => account.enabled)
    .map(({ pubkey, account }) => ({
      pubkey: pubkey.toString(),
      mint: account.mint.toString(),
      tier: convertTier(account.tier),
      enabled: account.enabled,
      poolAddress: account.poolAddress.toString(),
      ltvBps: account.ltvBps,
      interestRateBps: account.interestRateBps,
      liquidationBonusBps: account.liquidationBonusBps,
      minLoanAmount: account.minLoanAmount.toString(),
      maxLoanAmount: account.maxLoanAmount.toString(),
    }));
}

// Helper functions
function convertLoanAccount(account: any, pubkey: PublicKey): Loan {
  return {
    pubkey: pubkey.toString(),
    borrower: account.borrower.toString(),
    tokenMint: account.tokenMint.toString(),
    collateralAmount: account.collateralAmount.toString(),
    solBorrowed: account.solBorrowed.toString(),
    entryPrice: account.entryPrice.toString(),
    liquidationPrice: account.liquidationPrice.toString(),
    interestRateBps: account.interestRateBps,
    createdAt: account.createdAt.toNumber(),
    dueAt: account.dueAt.toNumber(),
    status: convertStatus(account.status),
    index: account.index.toNumber(),
  };
}

function convertTier(tier: any): TokenTier {
  if (tier.bronze) return TokenTier.Bronze;
  if (tier.silver) return TokenTier.Silver;
  if (tier.gold) return TokenTier.Gold;
  throw new Error('Unknown tier');
}

function convertStatus(status: any): LoanStatus {
  if (status.active) return LoanStatus.Active;
  if (status.repaid) return LoanStatus.Repaid;
  if (status.liquidatedTime) return LoanStatus.LiquidatedTime;
  if (status.liquidatedPrice) return LoanStatus.LiquidatedPrice;
  throw new Error('Unknown status');
}

function getStatusByte(status: LoanStatus): string {
  switch (status) {
    case LoanStatus.Active:
      return '1';
    case LoanStatus.Repaid:
      return '2';
    case LoanStatus.LiquidatedTime:
      return '3';
    case LoanStatus.LiquidatedPrice:
      return '4';
    default:
      throw new Error('Unknown status');
  }
}