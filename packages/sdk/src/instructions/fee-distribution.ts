import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionSignature } from '@solana/web3.js';
import * as pda from '../pda';

export async function initializeFeeReceiver(
  program: Program,
  treasuryWallet: PublicKey,
  operationsWallet: PublicKey,
  treasurySplitBps: number,
  stakingSplitBps: number,
  operationsSplitBps: number,
): Promise<TransactionSignature> {
  const [feeReceiver] = pda.getFeeReceiverPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .initializeFeeReceiver(treasurySplitBps, stakingSplitBps, operationsSplitBps)
    .accounts({
      feeReceiver,
      treasuryWallet,
      operationsWallet,
      stakingRewardVault: rewardVault,
      authority: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function distributeCreatorFees(
  program: Program,
): Promise<TransactionSignature> {
  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet as PublicKey;
  
  const [feeReceiver] = pda.getFeeReceiverPDA(program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  const [rewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .distributeCreatorFees()
    .accounts({
      feeReceiver,
      treasury,
      rewardVault,
      operationsWallet,
      payer: program.provider.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}