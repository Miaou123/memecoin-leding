import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, getStakingPoolPDA, getRewardVaultPDA, getProtocolStatePDA, getTreasuryPDA, getFeeReceiverPDA, getStakingVaultPDA } from './constants';

// Re-export PDA derivation functions
export { getStakingPoolPDA, getRewardVaultPDA, getProtocolStatePDA, getTreasuryPDA, getFeeReceiverPDA, getStakingVaultPDA, getUserStakePDA } from './constants';

// Derive user-specific PDAs
export function deriveUserStakePDA(stakingPool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  );
}

export function deriveLoanPDA(borrower: PublicKey, tokenMint: PublicKey, loanIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('loan'),
      borrower.toBuffer(),
      tokenMint.toBuffer(),
      Buffer.from(loanIndex.toString())
    ],
    PROGRAM_ID
  );
}

export function deriveTokenConfigPDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    PROGRAM_ID
  );
}

export function deriveVaultPDA(loanPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), loanPda.toBuffer()],
    PROGRAM_ID
  );
}

// Get deployment program ID
export function getDeploymentProgramId(): string {
  return PROGRAM_ID.toString();
}