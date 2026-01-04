import { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import { getStakingPoolPDA, getRewardVaultPDA, deriveUserStakePDA, getStakingVaultPDA } from '@memecoin-lending/config';

// Helper functions to get deployment PDAs
function getStakingPoolFromDeployment(): PublicKey {
  const pda = getStakingPoolPDA();
  if (!pda) throw new Error('Staking pool PDA not found in deployment');
  return pda;
}

function getRewardVaultFromDeployment(): PublicKey {
  const pda = getRewardVaultPDA();
  if (!pda) throw new Error('Reward vault PDA not found in deployment');
  return pda;
}

function getStakingVaultFromDeployment(): PublicKey {
  const pda = getStakingVaultPDA();
  if (!pda) throw new Error('Staking vault PDA not found in deployment');
  return pda;
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
  
  const stakingPool = getStakingPoolFromDeployment();
  const [userStake] = deriveUserStakePDA(stakingPool, user);
  const rewardVault = getRewardVaultFromDeployment();
  const stakingVaultAuthority = getStakingVaultFromDeployment();
  
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
  
  const stakingPool = getStakingPoolFromDeployment();
  const [userStake] = deriveUserStakePDA(stakingPool, user);
  const stakingVaultAuthority = getStakingVaultFromDeployment();
  const rewardVault = getRewardVaultFromDeployment();
  
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
  
  const stakingPool = getStakingPoolFromDeployment();
  const [userStake] = deriveUserStakePDA(stakingPool, user);
  const rewardVault = getRewardVaultFromDeployment();
  
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