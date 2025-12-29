import { Program } from '@coral-xyz/anchor';
import { PublicKey, TransactionSignature, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import * as pda from '../pda';

export async function initializeStaking(
  program: Program,
  stakingTokenMint: PublicKey,
  targetPoolBalance: BN,
  baseEmissionRate: BN,
  maxEmissionRate: BN,
  minEmissionRate: BN
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [stakingVaultAuthority] = pda.getStakingVaultAuthorityPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);
  
  const stakingVault = await getAssociatedTokenAddress(
    stakingTokenMint,
    stakingVaultAuthority,
    true
  );
  
  return program.methods
    .initializeStaking(targetPoolBalance, baseEmissionRate, maxEmissionRate, minEmissionRate)
    .accounts({
      stakingPool,
      stakingTokenMint,
      stakingVault,
      stakingVaultAuthority,
      rewardVault,
      authority: program.provider.publicKey\!,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function stake(
  program: Program,
  amount: BN,
  stakingTokenMint: PublicKey
): Promise<TransactionSignature> {
  const user = program.provider.publicKey\!;
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [userStake] = pda.getUserStakePDA(stakingPool, user, program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);
  
  const stakingVault = await getAssociatedTokenAddress(
    stakingTokenMint,
    pda.getStakingVaultAuthorityPDA(program.programId)[0],
    true
  );
  
  const userTokenAccount = await getAssociatedTokenAddress(
    stakingTokenMint,
    user
  );
  
  return program.methods
    .stake(amount)
    .accounts({
      stakingPool,
      userStake,
      stakingVault,
      userTokenAccount,
      rewardVault,
      user,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function unstake(
  program: Program,
  amount: BN,
  stakingTokenMint: PublicKey
): Promise<TransactionSignature> {
  const user = program.provider.publicKey\!;
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [userStake] = pda.getUserStakePDA(stakingPool, user, program.programId);
  const [stakingVaultAuthority] = pda.getStakingVaultAuthorityPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);
  
  const stakingVault = await getAssociatedTokenAddress(
    stakingTokenMint,
    stakingVaultAuthority,
    true
  );
  
  const userTokenAccount = await getAssociatedTokenAddress(
    stakingTokenMint,
    user
  );
  
  return program.methods
    .unstake(amount)
    .accounts({
      stakingPool,
      userStake,
      stakingVault,
      stakingVaultAuthority,
      userTokenAccount,
      rewardVault,
      user,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function claimRewards(
  program: Program
): Promise<TransactionSignature> {
  const user = program.provider.publicKey\!;
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [userStake] = pda.getUserStakePDA(stakingPool, user, program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);
  
  return program.methods
    .claimRewards()
    .accounts({
      stakingPool,
      userStake,
      rewardVault,
      user,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function depositRewards(
  program: Program,
  amount: BN
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);
  
  return program.methods
    .depositRewards(amount)
    .accounts({
      stakingPool,
      rewardVault,
      depositor: program.provider.publicKey\!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function updateStakingConfig(
  program: Program,
  params: {
    targetPoolBalance?: BN;
    baseEmissionRate?: BN;
    maxEmissionRate?: BN;
    minEmissionRate?: BN;
    paused?: boolean;
  }
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  
  return program.methods
    .updateStakingConfig(
      params.targetPoolBalance || null,
      params.baseEmissionRate || null,
      params.maxEmissionRate || null,
      params.minEmissionRate || null,
      params.paused \!== undefined ? params.paused : null
    )
    .accounts({
      stakingPool,
      authority: program.provider.publicKey\!,
    })
    .rpc();
}

export async function initializeFeeReceiver(
  program: Program,
  treasuryWallet: PublicKey,
  operationsWallet: PublicKey,  // RENAMED from devWallet
  treasurySplitBps: number,
  stakingSplitBps: number,
  operationsSplitBps: number    // RENAMED from devSplitBps
): Promise<TransactionSignature> {
  const [feeReceiver] = pda.getFeeReceiverPDA(program.programId);
  const [stakingRewardVault] = pda.getRewardVaultPDA(program.programId);
  
  return program.methods
    .initializeFeeReceiver(treasurySplitBps, stakingSplitBps, operationsSplitBps)
    .accounts({
      feeReceiver,
      treasuryWallet,
      operationsWallet,  // RENAMED
      stakingRewardVault,
      authority: program.provider.publicKey\!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function distributeCreatorFees(
  program: Program
): Promise<TransactionSignature> {
  const [feeReceiver] = pda.getFeeReceiverPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);
  
  // Fetch fee receiver to get wallet addresses
  const feeReceiverAccount = await program.account.feeReceiver.fetch(feeReceiver);
  
  return program.methods
    .distributeCreatorFees()
    .accounts({
      feeReceiver,
      treasuryWallet: feeReceiverAccount.treasuryWallet,
      operationsWallet: feeReceiverAccount.operationsWallet,  // RENAMED
      stakingRewardVault: rewardVault,
      caller: program.provider.publicKey\!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}
