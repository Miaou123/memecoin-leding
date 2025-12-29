import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  PublicKey,
  TransactionSignature,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import * as pda from '../pda';
import { getCommonInstructionAccounts } from '../utils';
import { PUMPFUN_PROGRAM_ID, RAYDIUM_PROGRAM_ID, ORCA_PROGRAM_ID } from '@memecoin-lending/config';

export async function initializeProtocol(
  program: Program,
  admin: PublicKey,
  buybackWallet: PublicKey,
  operationsWallet: PublicKey
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);

  return program.methods
    .initialize(admin, buybackWallet, operationsWallet)
    .accounts({
      protocolState,
      treasury,
      payer: program.provider.publicKey!,
      ...getCommonInstructionAccounts(),
    })
    .rpc();
}

export async function whitelistToken(
  program: Program,
  params: {
    mint: PublicKey;
    tier: number;
    poolType: number;
    poolAddress?: PublicKey; // Optional - will be derived if not provided
    minLoanAmount: BN;
    maxLoanAmount: BN;
  }
): Promise<TransactionSignature> {
  // Derive pool address based on pool type if not provided
  let poolAddress = params.poolAddress;
  
  if (!poolAddress) {
    if (params.poolType === 2) { // PumpFun pool type
      const [bondingCurve] = pda.getPumpFunBondingCurvePDA(params.mint);
      poolAddress = bondingCurve;
    } else {
      throw new Error('Pool address required for non-PumpFun tokens');
    }
  }
  
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(params.mint, program.programId);

  return program.methods
    .whitelistToken(
      params.tier,
      poolAddress,
      params.poolType,
      params.minLoanAmount,
      params.maxLoanAmount
    )
    .accounts({
      protocolState,
      tokenConfig,
      tokenMint: params.mint,
      admin: program.provider.publicKey!,
      ...getCommonInstructionAccounts(),
    })
    .rpc();
}

export async function buildCreateLoanTransaction(
  program: Program,
  params: {
    tokenMint: PublicKey;
    collateralAmount: BN;
    durationSeconds: BN;
    borrower: PublicKey;
  }
): Promise<Transaction> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(params.tokenMint, program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Fetch token config to get pool address
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfig);
  if (!tokenConfigAccount) {
    throw new Error('Token not whitelisted');
  }
  
  // Get the pool account from token config
  const poolAccount = tokenConfigAccount.poolAddress;
  
  // Get loan index from protocol state
  // TODO: Fetch actual loan count for this borrower+mint combination
  const loanIndex = new BN(0);
  
  const [loan] = pda.getLoanPDA(
    params.borrower,
    params.tokenMint,
    loanIndex,
    program.programId
  );
  
  const [vaultTokenAccount] = pda.getVaultTokenAccount(
    params.tokenMint,
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    params.tokenMint,
    params.borrower
  );

  // Determine pool program based on pool type
  let poolProgram: PublicKey;
  if (tokenConfigAccount.poolType.pumpfun) {
    poolProgram = PUMPFUN_PROGRAM_ID;
  } else if (tokenConfigAccount.poolType.raydium) {
    poolProgram = RAYDIUM_PROGRAM_ID;
  } else {
    poolProgram = ORCA_PROGRAM_ID;
  }

  // Build transaction without sending
  const tx = await program.methods
    .createLoan(params.collateralAmount, params.durationSeconds)
    .accounts({
      loan,
      protocolState,
      tokenConfig,
      treasury,
      borrower: params.borrower,
      borrowerTokenAccount,
      vaultTokenAccount,
      tokenMint: params.tokenMint,
      poolAccount,        // Now properly set!
      poolProgram,        // Pool program for CPI if needed
      ...getCommonInstructionAccounts(),
    })
    .transaction();  // Returns Transaction instead of sending
  
  return tx;
}

export async function createLoan(
  program: Program,
  params: {
    tokenMint: PublicKey;
    collateralAmount: BN;
    durationSeconds: BN;
    borrower: PublicKey;
  }
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(params.tokenMint, program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Fetch token config to get pool address
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfig);
  if (!tokenConfigAccount) {
    throw new Error('Token not whitelisted');
  }
  
  // Get the pool account from token config
  const poolAccount = tokenConfigAccount.poolAddress;
  
  // Get loan index from protocol state
  // TODO: Fetch actual loan count for this borrower+mint combination
  const loanIndex = new BN(0);
  
  const [loan] = pda.getLoanPDA(
    params.borrower,
    params.tokenMint,
    loanIndex,
    program.programId
  );
  
  const [vaultTokenAccount] = pda.getVaultTokenAccount(
    params.tokenMint,
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    params.tokenMint,
    params.borrower
  );

  // Determine pool program based on pool type
  let poolProgram: PublicKey;
  if (tokenConfigAccount.poolType.pumpfun) {
    poolProgram = PUMPFUN_PROGRAM_ID;
  } else if (tokenConfigAccount.poolType.raydium) {
    poolProgram = RAYDIUM_PROGRAM_ID;
  } else {
    poolProgram = ORCA_PROGRAM_ID;
  }

  return program.methods
    .createLoan(params.collateralAmount, params.durationSeconds)
    .accounts({
      loan,
      protocolState,
      tokenConfig,
      treasury,
      borrower: params.borrower,
      borrowerTokenAccount,
      vaultTokenAccount,
      tokenMint: params.tokenMint,
      poolAccount,        // Now properly set!
      poolProgram,        // Pool program for CPI if needed
      ...getCommonInstructionAccounts(),
    })
    .rpc();
}

export async function repayLoan(
  program: Program,
  loanPubkey: PublicKey
): Promise<TransactionSignature> {
  // Mock loan account data (in real implementation, this would fetch from blockchain)
  const loanAccount = {
    tokenMint: new PublicKey('So11111111111111111111111111111111111111112'), // Mock SOL mint
    borrower: new PublicKey('11111111111111111111111111111111'), // Mock borrower
  };
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  const [vaultTokenAccount] = pda.getVaultTokenAccount(
    loanAccount.tokenMint,
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    loanAccount.tokenMint,
    loanAccount.borrower
  );

  return program.methods
    .repayLoan()
    .accounts({
      loan: loanPubkey,
      protocolState,
      treasury,
      borrower: loanAccount.borrower,
      borrowerTokenAccount,
      vaultTokenAccount,
      tokenMint: loanAccount.tokenMint,
      ...getCommonInstructionAccounts(),
    })
    .rpc();
}

export async function liquidate(
  program: Program,
  loanPubkey: PublicKey
): Promise<TransactionSignature> {
  // Fetch loan to get token mint
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }
  
  const tokenMint = loanAccount.tokenMint;
  const borrower = loanAccount.borrower;
  
  // Fetch token config for pool address
  const [tokenConfigPDA] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfigPDA);
  
  const poolAccount = tokenConfigAccount.poolAddress;
  
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  const [vaultTokenAccount] = pda.getVaultTokenAccount(tokenMint, program.programId);
  
  const liquidatorTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    program.provider.publicKey!
  );

  // Determine pool program
  let poolProgram: PublicKey;
  if (tokenConfigAccount.poolType.pumpfun) {
    poolProgram = PUMPFUN_PROGRAM_ID;
  } else if (tokenConfigAccount.poolType.raydium) {
    poolProgram = RAYDIUM_PROGRAM_ID;
  } else {
    poolProgram = ORCA_PROGRAM_ID;
  }

  return program.methods
    .liquidate()
    .accounts({
      loan: loanPubkey,
      protocolState,
      tokenConfig: tokenConfigPDA,
      treasury,
      liquidator: program.provider.publicKey!,
      liquidatorTokenAccount,
      vaultTokenAccount,
      tokenMint,
      poolAccount,
      poolProgram,
      ...getCommonInstructionAccounts(),
    })
    .rpc();
}

export async function updateTokenConfig(
  program: Program,
  params: {
    mint: PublicKey;
    enabled?: boolean;
    ltvBps?: number;
    interestRateBps?: number;
  }
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(params.mint, program.programId);

  return program.methods
    .updateTokenConfig(
      params.enabled ?? null,
      params.ltvBps ?? null,
      params.interestRateBps ?? null
    )
    .accounts({
      protocolState,
      tokenConfig,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export async function pauseProtocol(
  program: Program
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);

  return program.methods
    .pauseProtocol()
    .accounts({
      protocolState,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export async function resumeProtocol(
  program: Program
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);

  return program.methods
    .resumeProtocol()
    .accounts({
      protocolState,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export async function withdrawTreasury(
  program: Program,
  amount: BN
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);

  return program.methods
    .withdrawTreasury(amount)
    .accounts({
      protocolState,
      treasury,
      admin: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function fundTreasury(
  program: Program,
  amount: BN
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  return program.methods
    .fundTreasury(amount)
    .accounts({
      protocolState,
      treasury,
      funder: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function updateFees(
  program: Program,
  params: {
    protocolFeeBps?: number;
    treasuryFeeBps?: number;
    buybackFeeBps?: number;
    operationsFeeBps?: number;
  }
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  
  return program.methods
    .updateFees(
      params.protocolFeeBps ?? null,
      params.treasuryFeeBps ?? null,
      params.buybackFeeBps ?? null,
      params.operationsFeeBps ?? null
    )
    .accounts({
      protocolState,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export async function updateWallets(
  program: Program,
  params: {
    newAdmin?: PublicKey;
    newBuybackWallet?: PublicKey;
    newOperationsWallet?: PublicKey;
  }
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  
  return program.methods
    .updateWallets(
      params.newAdmin ?? null,
      params.newBuybackWallet ?? null,
      params.newOperationsWallet ?? null
    )
    .accounts({
      protocolState,
      admin: program.provider.publicKey!,
    })
    .rpc();
}