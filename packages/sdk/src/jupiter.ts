import { PublicKey, AccountMeta } from '@solana/web3.js';
import BN from 'bn.js';

// NEW API endpoints (January 2025)
const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_INSTRUCTIONS_API = 'https://api.jup.ag/swap/v1/swap-instructions';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
}

export interface JupiterSwapInstructionResponse {
  tokenLedgerInstruction?: any;
  computeBudgetInstructions: any[];
  setupInstructions: any[];
  swapInstruction: {
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;
  };
  cleanupInstruction?: any;
  addressLookupTableAddresses: string[];
}

/**
 * Get quote for token → SOL swap
 */
export async function getJupiterQuote(
  inputMint: PublicKey,
  amount: BN,
  slippageBps: number = 150,
  apiKey?: string
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: inputMint.toString(),
    outputMint: NATIVE_SOL_MINT,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
    swapMode: 'ExactIn',
  });

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(`${JUPITER_QUOTE_API}?${params}`, { headers });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jupiter quote failed: ${response.status} - ${errorText}`);
  }
  
  return response.json() as Promise<JupiterQuote>;
}

/**
 * Get swap instruction for CPI
 */
export async function getJupiterSwapInstruction(
  quote: JupiterQuote,
  userPublicKey: PublicKey,
  apiKey?: string
): Promise<JupiterSwapInstructionResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(JUPITER_SWAP_INSTRUCTIONS_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: userPublicKey.toString(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jupiter swap instructions failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as any;
  
  if (result.error) {
    throw new Error(`Jupiter swap instructions error: ${result.error}`);
  }

  return result as JupiterSwapInstructionResponse;
}

/**
 * SECURITY: Slippage escalation levels for liquidation retries
 */
export const SLIPPAGE_ESCALATION_BPS = [
  300,  // 3% - First attempt
  500,  // 5% - Second attempt  
  700,  // 7% - Third attempt
  900,  // 9% - Fourth attempt
  1100, // 11% - Fifth attempt
  1500, // 15% - Final attempt
];

/**
 * Prepare Jupiter liquidation data for CPI
 */
export async function prepareJupiterLiquidation(
  tokenMint: PublicKey,
  amount: BN,
  vaultAuthority: PublicKey,
  slippageBps: number = 300,
  apiKey?: string
): Promise<{
  minSolOutput: BN;
  swapData: Buffer;
  routeAccounts: AccountMeta[];
}> {
  // Get quote
  const quote = await getJupiterQuote(tokenMint, amount, slippageBps, apiKey);
  
  // Get swap instruction for CPI
  const swapResponse = await getJupiterSwapInstruction(quote, vaultAuthority, apiKey);
  
  // Extract route accounts from swap instruction
  const routeAccounts: AccountMeta[] = swapResponse.swapInstruction.accounts.map(acc => ({
    pubkey: new PublicKey(acc.pubkey),
    isSigner: acc.isSigner,
    isWritable: acc.isWritable,
  }));
  
  // Decode swap data
  const swapData = Buffer.from(swapResponse.swapInstruction.data, 'base64');
  
  return {
    minSolOutput: new BN(quote.otherAmountThreshold),
    swapData,
    routeAccounts,
  };
}

/**
 * Prepare Jupiter liquidation with retry mechanism and slippage escalation
 */
export async function prepareJupiterLiquidationWithRetry(
  tokenMint: PublicKey,
  amount: BN,
  vaultAuthority: PublicKey,
  retryAttempt: number = 0,
  apiKey?: string
): Promise<{
  minSolOutput: BN;
  swapData: Buffer;
  routeAccounts: AccountMeta[];
  slippageBps: number;
  maxRetries: number;
}> {
  const maxRetries = SLIPPAGE_ESCALATION_BPS.length;
  
  if (retryAttempt >= maxRetries) {
    throw new Error(`Maximum liquidation retries exceeded (${maxRetries})`);
  }
  
  const slippageBps = SLIPPAGE_ESCALATION_BPS[retryAttempt];
  
  console.log(`🔄 Jupiter liquidation attempt ${retryAttempt + 1}/${maxRetries} with ${slippageBps/100}% slippage`);
  
  const result = await prepareJupiterLiquidation(tokenMint, amount, vaultAuthority, slippageBps, apiKey);
  
  return {
    ...result,
    slippageBps,
    maxRetries,
  };
}