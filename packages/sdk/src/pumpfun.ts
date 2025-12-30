import { PublicKey, Connection } from '@solana/web3.js';
import BN from 'bn.js';

export const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMPFUN_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const PUMPFUN_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
export const PUMPFUN_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

/**
 * Get bonding curve PDA for a token
 */
export function getBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID
  );
}

/**
 * Get bonding curve token account
 */
export async function getBondingCurveTokenAccount(
  connection: Connection,
  bondingCurve: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  return getAssociatedTokenAddress(mint, bondingCurve, true);
}

/**
 * Calculate expected SOL output from PumpFun sell
 */
export async function calculatePumpfunSellOutput(
  connection: Connection,
  bondingCurve: PublicKey,
  sellAmount: BN
): Promise<BN> {
  const accountInfo = await connection.getAccountInfo(bondingCurve);
  if (!accountInfo) {
    throw new Error('Bonding curve not found');
  }
  
  const data = accountInfo.data;
  
  // Parse bonding curve data
  const virtualTokenReserves = new BN(data.slice(8, 16), 'le');
  const virtualSolReserves = new BN(data.slice(16, 24), 'le');
  
  // Constant product: k = sol * tokens
  const k = virtualSolReserves.mul(virtualTokenReserves);
  const newVirtualTokens = virtualTokenReserves.add(sellAmount);
  const newVirtualSol = k.div(newVirtualTokens);
  
  let solOutput = virtualSolReserves.sub(newVirtualSol);
  
  // PumpFun takes 1% fee
  const fee = solOutput.div(new BN(100));
  solOutput = solOutput.sub(fee);
  
  return solOutput;
}

/**
 * SECURITY: Slippage escalation levels for PumpFun liquidation retries
 */
export const PUMPFUN_SLIPPAGE_ESCALATION_BPS = [
  300,  // 3% - First attempt
  500,  // 5% - Second attempt  
  700,  // 7% - Third attempt
  900,  // 9% - Fourth attempt
  1100, // 11% - Fifth attempt
  1500, // 15% - Final attempt
];

/**
 * Prepare PumpFun liquidation accounts
 */
export async function preparePumpfunLiquidation(
  connection: Connection,
  tokenMint: PublicKey,
  collateralAmount: BN,
  slippageBps: number = 300 // SECURITY: Default to 3% for first attempt
): Promise<{
  minSolOutput: BN;
  bondingCurve: PublicKey;
  bondingCurveTokenAccount: PublicKey;
}> {
  const [bondingCurve] = getBondingCurvePDA(tokenMint);
  const bondingCurveTokenAccount = await getBondingCurveTokenAccount(
    connection,
    bondingCurve,
    tokenMint
  );
  
  // Calculate expected output with configurable slippage
  const expectedOutput = await calculatePumpfunSellOutput(
    connection,
    bondingCurve,
    collateralAmount
  );
  
  // Apply slippage: minOutput = expectedOutput * (10000 - slippageBps) / 10000
  const slippageMultiplier = new BN(10000 - slippageBps);
  const minSolOutput = expectedOutput.mul(slippageMultiplier).div(new BN(10000));
  
  return {
    minSolOutput,
    bondingCurve,
    bondingCurveTokenAccount,
  };
}

/**
 * SECURITY: Prepare PumpFun liquidation with retry mechanism and slippage escalation
 */
export async function preparePumpfunLiquidationWithRetry(
  connection: Connection,
  tokenMint: PublicKey,
  collateralAmount: BN,
  retryAttempt: number = 0
): Promise<{
  minSolOutput: BN;
  bondingCurve: PublicKey;
  bondingCurveTokenAccount: PublicKey;
  slippageBps: number;
  maxRetries: number;
}> {
  const maxRetries = PUMPFUN_SLIPPAGE_ESCALATION_BPS.length;
  
  if (retryAttempt >= maxRetries) {
    throw new Error(`Maximum PumpFun liquidation retries exceeded (${maxRetries})`);
  }
  
  const slippageBps = PUMPFUN_SLIPPAGE_ESCALATION_BPS[retryAttempt];
  
  console.log(`🔄 PumpFun liquidation attempt ${retryAttempt + 1}/${maxRetries} with ${slippageBps/100}% slippage`);
  
  const result = await preparePumpfunLiquidation(connection, tokenMint, collateralAmount, slippageBps);
  
  return {
    ...result,
    slippageBps,
    maxRetries,
  };
}