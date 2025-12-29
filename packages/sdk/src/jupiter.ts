import { PublicKey, AccountMeta } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  routePlan: any[];
}

export interface JupiterSwapResponse {
  swapInstruction: {
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;
  };
  addressLookupTableAddresses: string[];
}

/**
 * Get quote for token → SOL swap
 */
export async function getJupiterQuote(
  inputMint: PublicKey,
  amount: BN,
  slippageBps: number = 150
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: inputMint.toString(),
    outputMint: NATIVE_SOL_MINT,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
    swapMode: 'ExactIn',
  });

  const response = await fetch(`${JUPITER_API_URL}/quote?${params}`);
  
  if (!response.ok) {
    throw new Error(`Jupiter quote failed: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Get swap instruction from Jupiter
 */
export async function getJupiterSwapInstruction(
  quote: JupiterQuote,
  userPublicKey: PublicKey
): Promise<JupiterSwapResponse> {
  const response = await fetch(`${JUPITER_API_URL}/swap-instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: userPublicKey.toString(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
      asLegacyTransaction: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Jupiter swap failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Prepare Jupiter liquidation data
 */
export async function prepareJupiterLiquidation(
  tokenMint: PublicKey,
  amount: BN,
  vaultAuthority: PublicKey,
  slippageBps: number = 150
): Promise<{
  minSolOutput: BN;
  swapData: Buffer;
  routeAccounts: AccountMeta[];
}> {
  // Get quote
  const quote = await getJupiterQuote(tokenMint, amount, slippageBps);
  
  // Get swap instruction
  const swapResponse = await getJupiterSwapInstruction(quote, vaultAuthority);
  
  // Extract route accounts
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