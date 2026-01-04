import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionSignature } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as pda from '../pda';

export async function initializeStaking(
  program: Program,
  stakingTokenMint: PublicKey,
  epochDuration: BN, // in seconds
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
    .initializeStaking(epochDuration)
    .accounts({
      stakingPool,
      stakingTokenMint,
      stakingVaultAuthority,
      stakingVault,
      rewardVault,
      authority: program.provider.publicKey!,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function stake(
  program: Program,
  amount: BN,
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const stakingPoolAccount = await (program.account as any).stakingPool.fetch(stakingPool);
  const stakingTokenMint = stakingPoolAccount.stakingTokenMint as PublicKey;
  
  const [userStake] = pda.getUserStakePDA(stakingPool, program.provider.publicKey!, program.programId);
  
  const userTokenAccount = await getAssociatedTokenAddress(
    stakingTokenMint,
    program.provider.publicKey!
  );

  return program.methods
    .stake(amount)
    .accounts({
      stakingPool,
      userStake,
      stakingVault: stakingPoolAccount.stakingVault,
      userTokenAccount,
      user: program.provider.publicKey!,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function unstake(
  program: Program,
  amount: BN,
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const stakingPoolAccount = await (program.account as any).stakingPool.fetch(stakingPool);
  const stakingTokenMint = stakingPoolAccount.stakingTokenMint as PublicKey;
  
  const [userStake] = pda.getUserStakePDA(stakingPool, program.provider.publicKey!, program.programId);
  const [stakingVaultAuthority] = pda.getStakingVaultAuthorityPDA(program.programId);
  
  const userTokenAccount = await getAssociatedTokenAddress(
    stakingTokenMint,
    program.provider.publicKey!
  );

  return program.methods
    .unstake(amount)
    .accounts({
      stakingPool,
      userStake,
      stakingVault: stakingPoolAccount.stakingVault,
      stakingVaultAuthority,
      userTokenAccount,
      user: program.provider.publicKey!,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function claimRewards(
  program: Program,
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [userStake] = pda.getUserStakePDA(stakingPool, program.provider.publicKey!, program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .claimRewards()
    .accounts({
      stakingPool,
      userStake,
      rewardVault,
      user: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function depositRewards(
  program: Program,
  amount: BN,
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .depositRewards(amount)
    .accounts({
      stakingPool,
      rewardVault,
      depositor: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

// Admin functions
export async function pauseStaking(program: Program): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);

  return program.methods
    .pauseStaking()
    .accounts({
      stakingPool,
      authority: program.provider.publicKey!,
    })
    .rpc();
}

export async function resumeStaking(program: Program): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);

  return program.methods
    .resumeStaking()
    .accounts({
      stakingPool,
      authority: program.provider.publicKey!,
    })
    .rpc();
}

export async function updateEpochDuration(
  program: Program,
  newDuration: BN,
): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);

  return program.methods
    .updateEpochDuration(newDuration)
    .accounts({
      stakingPool,
      authority: program.provider.publicKey!,
    })
    .rpc();
}

export async function forceAdvanceEpoch(program: Program): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);

  return program.methods
    .forceAdvanceEpoch()
    .accounts({
      stakingPool,
      authority: program.provider.publicKey!,
    })
    .rpc();
}

export async function emergencyWithdraw(program: Program): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .emergencyWithdraw()
    .accounts({
      stakingPool,
      rewardVault,
      authority: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function emergencyDrainRewards(program: Program): Promise<TransactionSignature> {
  const [stakingPool] = pda.getStakingPoolPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .emergencyDrainRewards()
    .accounts({
      stakingPool,
      rewardVault,
      authority: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}