import { Connection, PublicKey, TransactionInstruction, Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import { 
  PROGRAM_ID, 
  getDeploymentConfig,
  type Network
} from '@memecoin-lending/config';

// Get network from environment
const NETWORK = (import.meta.env.VITE_SOLANA_NETWORK || 'devnet') as Network;

function getStakingAddresses() {
  const config = getDeploymentConfig(NETWORK);
  if (!config.staking) {
    throw new Error('Staking not configured in deployment');
  }
  
  // Derive the staking vault authority PDA instead of reading from config
  const [stakingVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_vault')],
    new PublicKey(PROGRAM_ID)
  );
  
  return {
    stakingPool: new PublicKey(config.staking.stakingPool),
    stakingTokenMint: new PublicKey(config.staking.stakingTokenMint),
    stakingVault: new PublicKey(config.staking.stakingVault),
    stakingVaultAuthority, // Use the derived PDA
    rewardVault: new PublicKey(config.staking.rewardVault),
  };
}

// Derive user stake PDA
function deriveUserStakePDALocal(stakingPool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    new PublicKey(PROGRAM_ID)
  );
}

// Instruction discriminators (from IDL)
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]); // stake
const UNSTAKE_DISCRIMINATOR = Buffer.from([90, 95, 107, 42, 205, 124, 50, 225]); // unstake

export async function buildStakeTransaction(
  user: PublicKey,
  amount: BN,
  connection: Connection
): Promise<Transaction> {
  const programId = new PublicKey(PROGRAM_ID);
  const { stakingPool, stakingVault, stakingTokenMint } = getStakingAddresses();
  
  const [userStake] = deriveUserStakePDALocal(stakingPool, user);
  const userTokenAccount = await getAssociatedTokenAddress(stakingTokenMint, user);
  
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
  
  // Explicitly set signers
  transaction.setSigners(user);
  
  return transaction;
}

export async function buildUnstakeTransaction(
  user: PublicKey,
  amount: BN,
  connection: Connection
): Promise<Transaction> {
  const programId = new PublicKey(PROGRAM_ID);
  const { stakingPool, stakingVault, stakingVaultAuthority, stakingTokenMint } = getStakingAddresses();
  
  const [userStake] = deriveUserStakePDALocal(stakingPool, user);
  const userTokenAccount = await getAssociatedTokenAddress(stakingTokenMint, user);
  
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
  
  // Explicitly set signers
  transaction.setSigners(user);
  
  return transaction;
}

