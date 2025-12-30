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
    tokenDecimals = 6, // Default to 6 for PumpFun tokens
  } = params;

  const collateralBN = new BN(collateralAmount);
  const priceBN = new BN(currentPrice);
  const durationBN = new BN(durationSeconds);
  
  // Token decimals divisor (10^6 for PumpFun)
  const DECIMALS_DIVISOR = new BN(10).pow(new BN(tokenDecimals));

  // Calculate collateral value in lamports
  // collateralAmount is in smallest units (raw)
  // currentPrice is in lamports per WHOLE token
  // So: value = collateralAmount * price / 10^decimals
  const collateralValue = collateralBN.mul(priceBN).div(DECIMALS_DIVISOR);
  
  // Calculate SOL amount based on LTV
  const solAmount = collateralValue.mul(new BN(tokenConfig.ltvBps)).div(new BN(BPS_DIVISOR));

  // Calculate protocol fee (2% flat)
  const protocolFee = solAmount.mul(new BN(PROTOCOL_FEE_BPS)).div(new BN(BPS_DIVISOR));

  // Total owed
  const totalOwed = solAmount.add(protocolFee);

  // Calculate liquidation price
  // Liquidation happens when collateral value falls below totalOwed / (LTV + buffer)
  const liquidationLtv = new BN(tokenConfig.ltvBps + 500); // Add 5% buffer
  const liquidationPrice = collateralBN.isZero() 
    ? new BN(0)
    : totalOwed
        .mul(DECIMALS_DIVISOR)
        .mul(new BN(BPS_DIVISOR))
        .div(collateralBN)
        .div(liquidationLtv);

  return {
    solAmount: solAmount.toString(),
    protocolFeeBps: 200, // Always 2% (200 basis points)
    totalOwed: totalOwed.toString(),
    liquidationPrice: liquidationPrice.toString(),
    ltv: tokenConfig.ltvBps / 100,
  };
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