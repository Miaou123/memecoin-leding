import BN from 'bn.js';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { LoanTermsParams, LoanTerms, TokenConfig } from '@memecoin-lending/types';
import { PROTOCOL_FEE_BPS, LTV_SCALING, LOAN_DURATION } from '@memecoin-lending/config';

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

  // Calculate duration-adjusted LTV
  const effectiveLtvBps = calculateDurationAdjustedLtv(
    tokenConfig.ltvBps,
    durationSeconds
  );

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
  
  // Calculate SOL amount based on EFFECTIVE LTV (not base)
  const solAmount = collateralValue
    .mul(new BN(effectiveLtvBps))
    .div(new BN(BPS_DIVISOR));

  // Calculate protocol fee (2% flat)
  const protocolFee = solAmount.mul(new BN(PROTOCOL_FEE_BPS)).div(new BN(BPS_DIVISOR));

  // Total owed
  const totalOwed = solAmount.add(protocolFee);

  // Calculate liquidation price
  // Liquidation happens when: collateral_amount × liquidation_price = total_owed
  // Therefore: liquidation_price = total_owed / collateral_amount (adjusted for decimals)
  const liquidationPrice = collateralBN.isZero() 
    ? new BN(0)
    : totalOwed
        .mul(DECIMALS_DIVISOR)
        .div(collateralBN);

  return {
    solAmount: solAmount.toString(),
    protocolFeeBps: 200, // Always 2% (200 basis points)
    totalOwed: totalOwed.toString(),
    liquidationPrice: liquidationPrice.toString(),
    ltv: effectiveLtvBps / 100, // Return effective LTV for display
    baseLtv: tokenConfig.ltvBps / 100, // Also return base for reference
    ltvModifier: getLtvModifierDisplay(durationSeconds),
  };
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

export function determineTierByLiquidity(liquidityUsd: number): number {
  if (liquidityUsd >= 300_000) return 2; // Gold
  if (liquidityUsd >= 100_000) return 1; // Silver
  return 0; // Bronze
}

export function getLtvBpsForTier(tier: number, isProtocolToken: boolean = false): number {
  if (isProtocolToken) return 5000;
  switch (tier) {
    case 2: return 5000; // Gold
    case 1: return 3500; // Silver
    default: return 2500; // Bronze
  }
}

/**
 * Calculate duration-adjusted LTV
 * @param baseLtvBps - Base LTV in basis points
 * @param durationSeconds - Loan duration in seconds
 * @returns Effective LTV in basis points
 */
export function calculateDurationAdjustedLtv(
  baseLtvBps: number,
  durationSeconds: number
): number {
  const { BASE_DURATION_SECONDS, MAX_BONUS_BPS, MAX_PENALTY_BPS } = LTV_SCALING;
  const { MIN_SECONDS, MAX_SECONDS } = LOAN_DURATION;
  
  // Clamp duration
  const duration = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, durationSeconds));
  
  let effectiveLtv: number;
  
  if (duration <= BASE_DURATION_SECONDS) {
    // Shorter = bonus
    const durationRange = BASE_DURATION_SECONDS - MIN_SECONDS; // 36h
    const durationDiff = BASE_DURATION_SECONDS - duration;
    const bonusRatio = durationDiff / durationRange;
    const bonus = (baseLtvBps * MAX_BONUS_BPS * bonusRatio) / 10000;
    effectiveLtv = baseLtvBps + bonus;
  } else {
    // Longer = penalty
    const durationRange = MAX_SECONDS - BASE_DURATION_SECONDS; // 120h
    const durationDiff = duration - BASE_DURATION_SECONDS;
    const penaltyRatio = durationDiff / durationRange;
    const penalty = (baseLtvBps * MAX_PENALTY_BPS * penaltyRatio) / 10000;
    effectiveLtv = baseLtvBps - penalty;
  }
  
  // Clamp to reasonable bounds
  return Math.max(1000, Math.min(9000, Math.round(effectiveLtv)));
}

/**
 * Get LTV modifier percentage for display
 * @param durationSeconds - Loan duration in seconds
 * @returns Modifier as percentage string (e.g., "+25%", "-12.5%")
 */
export function getLtvModifierDisplay(durationSeconds: number): string {
  const { BASE_DURATION_SECONDS, MAX_BONUS_BPS, MAX_PENALTY_BPS } = LTV_SCALING;
  const { MIN_SECONDS, MAX_SECONDS } = LOAN_DURATION;
  
  const duration = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, durationSeconds));
  
  if (duration <= BASE_DURATION_SECONDS) {
    const durationRange = BASE_DURATION_SECONDS - MIN_SECONDS;
    const durationDiff = BASE_DURATION_SECONDS - duration;
    const bonusPercent = (MAX_BONUS_BPS / 100) * (durationDiff / durationRange);
    return bonusPercent > 0 ? `+${bonusPercent.toFixed(1)}%` : '0%';
  } else {
    const durationRange = MAX_SECONDS - BASE_DURATION_SECONDS;
    const durationDiff = duration - BASE_DURATION_SECONDS;
    const penaltyPercent = (MAX_PENALTY_BPS / 100) * (durationDiff / durationRange);
    return `-${penaltyPercent.toFixed(1)}%`;
  }
}