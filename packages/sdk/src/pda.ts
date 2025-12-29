import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  PROTOCOL_SEED,
  TREASURY_SEED,
  TOKEN_CONFIG_SEED,
  LOAN_SEED,
  PUMPFUN_PROGRAM_ID,
} from '@memecoin-lending/config';

export function getProtocolStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PROTOCOL_SEED],
    programId
  );
}

export function getTreasuryPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED],
    programId
  );
}

export function getTokenConfigPDA(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TOKEN_CONFIG_SEED, mint.toBuffer()],
    programId
  );
}

export function getLoanPDA(
  borrower: PublicKey,
  mint: PublicKey,
  index: BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      LOAN_SEED,
      borrower.toBuffer(),
      mint.toBuffer(),
      index.toArrayLike(Buffer, 'le', 8),
    ],
    programId
  );
}

export function getBorrowerTokenAccount(
  borrower: PublicKey,
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('borrower_token'),
      borrower.toBuffer(),
      mint.toBuffer(),
    ],
    programId
  );
}

export function getVaultPDA(
  loanPubkey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    programId
  );
}

// Deprecated: Use getVaultPDA instead
export function getVaultTokenAccount(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  // This function is now deprecated in favor of getVaultPDA
  // Keeping for backwards compatibility but should not be used for new vault structure
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('vault'),
      mint.toBuffer(),
    ],
    programId
  );
}

export function getPumpFunBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID
  );
}
// === STAKING PDA FUNCTIONS ===

export function getStakingPoolPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );
}

export function getStakingVaultAuthorityPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('staking_vault')],
    programId
  );
}

export function getRewardVaultPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reward_vault')],
    programId
  );
}

export function getUserStakePDA(
  stakingPool: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    programId
  );
}

export function getFeeReceiverPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_receiver')],
    programId
  );
}
