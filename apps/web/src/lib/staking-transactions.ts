import { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import { PROGRAM_ID } from '@memecoin-lending/config';

// PDA derivation functions (matching SDK)
function getStakingPoolPDA(): [PublicKey, number] {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );
}

function getUserStakePDA(stakingPool: PublicKey, user: PublicKey): [PublicKey, number] {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    programId
  );
}

function getRewardVaultPDA(): [PublicKey, number] {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reward_vault')],
    programId
  );
}

function getStakingVaultAuthorityPDA(): [PublicKey, number] {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('staking_vault')],
    programId
  );
}

// Instruction discriminators (from IDL)
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]); // stake
const UNSTAKE_DISCRIMINATOR = Buffer.from([90, 95, 107, 42, 205, 124, 50, 225]); // unstake
const CLAIM_REWARDS_DISCRIMINATOR = Buffer.from([4, 144, 132, 71, 116, 23, 44, 152]); // claim_rewards

export async function buildStakeTransaction(
  user: PublicKey,
  amount: BN,
  tokenMint: PublicKey,
  connection: Connection
): Promise<Transaction> {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  
  const [stakingPool] = getStakingPoolPDA();
  const [userStake] = getUserStakePDA(stakingPool, user);
  const [rewardVault] = getRewardVaultPDA();
  const [stakingVaultAuthority] = getStakingVaultAuthorityPDA();
  
  const stakingVault = await getAssociatedTokenAddress(tokenMint, stakingVaultAuthority, true);
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, user);
  
  // Build instruction data
  const data = Buffer.concat([
    STAKE_DISCRIMINATOR,
    amount.toBuffer('le', 8)
  ]);
  
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: stakingPool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: stakingVault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: rewardVault, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data
  });
  
  const transaction = new Transaction();
  transaction.add(instruction);
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;
  
  return transaction;
}

export async function buildUnstakeTransaction(
  user: PublicKey,
  amount: BN,
  tokenMint: PublicKey,
  connection: Connection
): Promise<Transaction> {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  
  const [stakingPool] = getStakingPoolPDA();
  const [userStake] = getUserStakePDA(stakingPool, user);
  const [stakingVaultAuthority] = getStakingVaultAuthorityPDA();
  const [rewardVault] = getRewardVaultPDA();
  
  const stakingVault = await getAssociatedTokenAddress(tokenMint, stakingVaultAuthority, true);
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, user);
  
  // Build instruction data
  const data = Buffer.concat([
    UNSTAKE_DISCRIMINATOR,
    amount.toBuffer('le', 8)
  ]);
  
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: stakingPool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: stakingVault, isSigner: false, isWritable: true },
      { pubkey: stakingVaultAuthority, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: rewardVault, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data
  });
  
  const transaction = new Transaction();
  transaction.add(instruction);
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;
  
  return transaction;
}

export async function buildClaimRewardsTransaction(
  user: PublicKey,
  connection: Connection
): Promise<Transaction> {
  const programId = typeof PROGRAM_ID === 'string' ? new PublicKey(PROGRAM_ID) : PROGRAM_ID;
  
  const [stakingPool] = getStakingPoolPDA();
  const [userStake] = getUserStakePDA(stakingPool, user);
  const [rewardVault] = getRewardVaultPDA();
  
  // Build instruction data (just discriminator)
  const data = CLAIM_REWARDS_DISCRIMINATOR;
  
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: stakingPool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: rewardVault, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data
  });
  
  const transaction = new Transaction();
  transaction.add(instruction);
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;
  
  return transaction;
}