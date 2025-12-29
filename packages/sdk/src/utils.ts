import BN from 'bn.js';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { LoanTermsParams, LoanTerms, TokenConfig } from '@memecoin-lending/types';
import { PROTOCOL_FEE_BPS } from '@memecoin-lending/config';

export const BPS_DIVISOR = 10000;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export function calculateLoanTerms(params: LoanTermsParams): LoanTerms {
  const {
    collateralAmount,
    durationSeconds,
    currentPrice,
    tokenConfig,
  } = params;

  const collateralBN = new BN(collateralAmount);
  const priceBN = new BN(currentPrice);
  const durationBN = new BN(durationSeconds);

  // Calculate SOL amount based on LTV
  const collateralValue = collateralBN.mul(priceBN).div(new BN(LAMPORTS_PER_SOL));
  const solAmount = collateralValue.mul(new BN(tokenConfig.ltvBps)).div(new BN(BPS_DIVISOR));

  // Calculate interest
  const annualSeconds = new BN(365 * 24 * 60 * 60);
  const interestRate = tokenConfig.interestRateBps;
  const interest = solAmount
    .mul(new BN(interestRate))
    .mul(durationBN)
    .div(new BN(BPS_DIVISOR))
    .div(annualSeconds);

  // Calculate protocol fee
  const protocolFee = solAmount.mul(new BN(PROTOCOL_FEE_BPS)).div(new BN(BPS_DIVISOR));

  // Total owed
  const totalOwed = solAmount.add(interest).add(protocolFee);

  // Calculate liquidation price (price at which LTV exceeds threshold)
  const liquidationLtv = new BN(tokenConfig.ltvBps + 500); // Add 5% buffer
  const liquidationPrice = totalOwed
    .mul(new BN(BPS_DIVISOR))
    .mul(new BN(LAMPORTS_PER_SOL))
    .div(collateralBN)
    .div(liquidationLtv);

  return {
    solAmount: solAmount.toString(),
    interestRate: interestRate,
    totalOwed: totalOwed.toString(),
    liquidationPrice: liquidationPrice.toString(),
    ltv: tokenConfig.ltvBps / 100,
  };
}

export function calculateInterest(
  principal: BN,
  rateBps: number,
  durationSeconds: BN
): BN {
  const annualSeconds = new BN(365 * 24 * 60 * 60);
  return principal
    .mul(new BN(rateBps))
    .mul(durationSeconds)
    .div(new BN(BPS_DIVISOR))
    .div(annualSeconds);
}

export function calculateLiquidationBonus(
  collateralAmount: BN,
  bonusBps: number
): BN {
  return collateralAmount.mul(new BN(bonusBps)).div(new BN(BPS_DIVISOR));
}

export async function getAssociatedTokenAddressAndCheckOwner(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(
    mint,
    owner,
    allowOwnerOffCurve
  );
  return ata;
}

export function getCommonInstructionAccounts() {
  return {
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  };
}

export function formatTokenAmount(
  amount: string | BN,
  decimals: number
): string {
  const amountBN = typeof amount === 'string' ? new BN(amount) : amount;
  const divisor = new BN(10).pow(new BN(decimals));
  const wholePart = amountBN.div(divisor);
  const fractionalPart = amountBN.mod(divisor);
  
  if (fractionalPart.isZero()) {
    return wholePart.toString();
  }
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');
  
  return `${wholePart.toString()}.${trimmedFractional}`;
}

export function parseTokenAmount(
  amount: string,
  decimals: number
): BN {
  const parts = amount.split('.');
  const wholePart = parts[0];
  const fractionalPart = parts[1] || '';
  
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  const combined = wholePart + paddedFractional;
  
  return new BN(combined);
}

export function getCurrentTimestamp(): BN {
  return new BN(Math.floor(Date.now() / 1000));
}

export function isExpired(timestamp: BN | number): boolean {
  const now = getCurrentTimestamp();
  const ts = typeof timestamp === 'number' ? new BN(timestamp) : timestamp;
  return now.gt(ts);
}