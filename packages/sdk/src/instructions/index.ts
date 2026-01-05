import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  PublicKey,
  TransactionSignature,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import * as pda from '../pda';
import { getCommonInstructionAccounts } from '../utils';
import { PUMPFUN_PROGRAM_ID, RAYDIUM_PROGRAM_ID, ORCA_PROGRAM_ID } from '@memecoin-lending/config';
import { PoolType } from '@memecoin-lending/types';
import { 
  PUMPFUN_GLOBAL, 
  PUMPFUN_FEE_RECIPIENT, 
  PUMPFUN_EVENT_AUTHORITY,
} from '../pumpfun';

const JUPITER_V6_PROGRAM_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

export async function initializeProtocol(
  program: Program,
  admin: PublicKey,
  buybackWallet: PublicKey,
  operationsWallet: PublicKey,
  authorizedLiquidator?: PublicKey,  // NEW - defaults to admin
  priceAuthority?: PublicKey          // NEW - defaults to admin
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);

  // Default to admin if not provided
  const liquidator = authorizedLiquidator || admin;
  const priceAuth = priceAuthority || admin;

  return program.methods
    .initialize(admin, buybackWallet, operationsWallet, liquidator, priceAuth)
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
  
  // Fetch protocol state to get loan index
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  if (!protocolStateAccount) {
    throw new Error('Protocol not initialized');
  }
  
  // Fetch token config to get pool address
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfig);
  if (!tokenConfigAccount) {
    throw new Error('Token not whitelisted');
  }
  
  // Get the pool account from token config
  const poolAccount = tokenConfigAccount.poolAddress;
  
  // Use protocol state's total loans count as the loan index
  const loanIndex = protocolStateAccount.totalLoansCreated;
  
  const [loan] = pda.getLoanPDA(
    params.borrower,
    params.tokenMint,
    loanIndex,
    program.programId
  );
  
  // Use new vault derivation - vault is now derived from loan PDA
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loan.toBuffer()],
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

export async function buildRepayLoanTransaction(
  program: Program,
  loanPubkey: PublicKey,
  borrower: PublicKey
): Promise<Transaction> {
  // Fetch actual loan data from chain
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }

  const tokenMint = loanAccount.tokenMint;

  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Vault uses loan PDA as authority
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower
  );

  // Fetch protocol state to get operations wallet
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;

  // Derive staking reward vault PDA
  const [stakingRewardVault] = pda.getRewardVaultPDA(program.programId);

  const tx = await program.methods
    .repayLoan()
    .accounts({
      protocolState,
      tokenConfig,
      loan: loanPubkey,
      treasury,
      operationsWallet,
      stakingRewardVault,
      borrower,
      borrowerTokenAccount,
      vaultTokenAccount,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

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
  
  // Fetch protocol state to get loan index
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  if (!protocolStateAccount) {
    throw new Error('Protocol not initialized');
  }
  
  // Fetch token config to get pool address
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfig);
  if (!tokenConfigAccount) {
    throw new Error('Token not whitelisted');
  }
  
  // Get the pool account from token config
  const poolAccount = tokenConfigAccount.poolAddress;
  
  // Use protocol state's total loans count as the loan index
  const loanIndex = protocolStateAccount.totalLoansCreated;
  
  const [loan] = pda.getLoanPDA(
    params.borrower,
    params.tokenMint,
    loanIndex,
    program.programId
  );
  
  // Use new vault derivation - vault is now derived from loan PDA
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loan.toBuffer()],
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
  // Fetch actual loan data from chain
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }

  const tokenMint = loanAccount.tokenMint;
  const borrower = loanAccount.borrower;

  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Vault uses loan PDA as authority - derive vault token account correctly
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower
  );

  // Fetch protocol state to get operations wallet
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;

  // Derive staking reward vault PDA
  const [stakingRewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .repayLoan()
    .accounts({
      protocolState,
      tokenConfig,
      loan: loanPubkey,
      treasury,
      operationsWallet,
      stakingRewardVault,
      borrower,
      borrowerTokenAccount,
      vaultTokenAccount,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function liquidate(
  program: Program,
  loanPubkey: PublicKey,
  minSolOutput: BN = new BN(0)
): Promise<TransactionSignature> {
  // Fetch loan to get token mint
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }
  
  const tokenMint = loanAccount.tokenMint;
  
  // Fetch token config for pool address
  const [tokenConfigPDA] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfigPDA);
  
  const poolAccount = tokenConfigAccount.poolAddress;
  
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;
  
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Vault uses loan PDA as authority
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );

  return program.methods
    .liquidate(minSolOutput, null) // Legacy parameters
    .accounts({
      protocolState,
      tokenConfig: tokenConfigPDA,
      loan: loanPubkey,
      treasury,
      operationsWallet,
      vaultTokenAccount,
      vaultAuthority,
      tokenMint,
      poolAccount,
      payer: program.provider.publicKey!,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/**
 * Liquidate loan using PumpFun bonding curve
 */
export async function liquidateWithPumpfun(
  program: Program,
  loanPubkey: PublicKey,
  connection: Connection
): Promise<TransactionSignature> {
  const { preparePumpfunLiquidation } = await import('../pumpfun');
  
  // Fetch loan to get token mint
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }
  
  const tokenMint = loanAccount.tokenMint;
  const collateralAmount = loanAccount.collateralAmount;
  
  // Prepare PumpFun liquidation
  const { minSolOutput, bondingCurve, bondingCurveTokenAccount } = 
    await preparePumpfunLiquidation(connection, tokenMint, collateralAmount);
  
  // Fetch token config and protocol state
  const [tokenConfigPDA] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfigPDA);
  const poolAccount = tokenConfigAccount.poolAddress;
  
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;
  
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Vault uses loan PDA as authority
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );

  return program.methods
    .liquidate(minSolOutput, null) // No Jupiter data for PumpFun
    .accounts({
      protocolState,
      tokenConfig: tokenConfigPDA,
      loan: loanPubkey,
      treasury,
      operationsWallet,
      vaultTokenAccount,
      vaultAuthority,
      tokenMint,
      poolAccount,
      pumpfunProgram: PUMPFUN_PROGRAM_ID,
      pumpfunGlobal: PUMPFUN_GLOBAL,
      pumpfunFeeRecipient: PUMPFUN_FEE_RECIPIENT,
      bondingCurve,
      bondingCurveTokenAccount,
      pumpfunEventAuthority: PUMPFUN_EVENT_AUTHORITY,
      payer: program.provider.publicKey!,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/**
 * Liquidate loan using Jupiter aggregator
 */
export async function liquidateWithJupiter(
  program: Program,
  loanPubkey: PublicKey,
  slippageBps: number = 150
): Promise<TransactionSignature> {
  const { prepareJupiterLiquidation } = await import('../jupiter');
  
  // Fetch loan to get token mint
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }
  
  const tokenMint = loanAccount.tokenMint;
  const collateralAmount = loanAccount.collateralAmount;
  
  // Get vault authority for Jupiter swap
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  // Prepare Jupiter liquidation
  const { minSolOutput, swapData, routeAccounts } = 
    await prepareJupiterLiquidation(tokenMint, collateralAmount, vaultAuthority, slippageBps);
  
  // Fetch token config and protocol state
  const [tokenConfigPDA] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const tokenConfigAccount = await (program.account as any).tokenConfig.fetch(tokenConfigPDA);
  const poolAccount = tokenConfigAccount.poolAddress;
  
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;
  
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Vault uses loan PDA as authority
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );

  return program.methods
    .liquidate(minSolOutput, Array.from(swapData)) // Jupiter swap data
    .accounts({
      protocolState,
      tokenConfig: tokenConfigPDA,
      loan: loanPubkey,
      treasury,
      operationsWallet,
      vaultTokenAccount,
      vaultAuthority,
      tokenMint,
      poolAccount,
      jupiterProgram: JUPITER_V6_PROGRAM_ID,
      payer: program.provider.publicKey!,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(routeAccounts)
    .rpc();
}

export async function updateTokenConfig(
  program: Program,
  params: {
    mint: PublicKey;
    enabled?: boolean;
    ltvBps?: number;
  }
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(params.mint, program.programId);

  return program.methods
    .updateTokenConfig(
      params.enabled ?? null,
      params.ltvBps ?? null
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
    newBuybackWallet?: PublicKey;
    newOperationsWallet?: PublicKey;
  }
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  
  return program.methods
    .updateWallets(
      params.newBuybackWallet ?? null,
      params.newOperationsWallet ?? null
    )
    .accounts({
      protocolState,
      admin: program.provider.publicKey!,
    })
    .rpc();
}
export async function closeProtocolState(
  program: Program
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  
  return program.methods
    .closeProtocolState()
    .accounts({
      protocolState,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export async function closeFeeReceiver(
  program: Program
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [feeReceiver] = pda.getFeeReceiverPDA(program.programId);
  
  return program.methods
    .closeFeeReceiver()
    .accounts({
      protocolState,
      feeReceiver,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export async function closeStakingPool(
  program: Program
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  
  return program.methods
    .closeStakingPool()
    .accounts({
      stakingPool,
      authority: program.provider.publicKey!,
    })
    .rpc();
}

export async function closeAllPDAs(
  program: Program
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [feeReceiver] = pda.getFeeReceiverPDA(program.programId);
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  
  return program.methods
    .closeAllPdas()
    .accounts({
      protocolState,
      feeReceiver,
      stakingPool,
      admin: program.provider.publicKey!,
    })
    .rpc();
}

export * from './staking';
export * from './fee-distribution';
