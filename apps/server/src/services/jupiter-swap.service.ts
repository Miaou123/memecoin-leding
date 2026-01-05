import { Connection, PublicKey, VersionedTransaction, Keypair } from '@solana/web3.js';
import { getConnection } from './solana.service.js';
import { getAdminKeypair } from '../config/keys.js';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

// Slippage for liquidation swaps (higher tolerance for memecoins)
const LIQUIDATION_SLIPPAGE_BPS = 500; // 5% slippage
const DRY_RUN_MODE = process.env.LIQUIDATION_DRY_RUN === 'true';

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: any[];
}

export interface SwapResult {
  success: boolean;
  txSignature?: string;
  inputAmount: bigint;
  outputAmount: bigint;  // Actual SOL received
  priceImpactPct: number;
  error?: string;
}

/**
 * Get a quote for swapping collateral token to SOL
 */
export async function getSwapQuote(
  inputMint: string,
  inputAmount: bigint,
  slippageBps: number = LIQUIDATION_SLIPPAGE_BPS
): Promise<SwapQuote | null> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint: NATIVE_SOL_MINT,
      amount: inputAmount.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false',
      asLegacyTransaction: 'false',
    });

    const response = await fetch(`${JUPITER_QUOTE_API}?${params}`);
    
    if (!response.ok) {
      console.error('[JupiterSwap] Quote API error:', response.status, await response.text());
      return null;
    }

    const quote = await response.json() as any;
    
    return {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
      slippageBps,
      routePlan: quote.routePlan,
    };
  } catch (error: any) {
    console.error('[JupiterSwap] Failed to get quote:', error.message);
    return null;
  }
}

/**
 * Execute a swap from collateral token to SOL
 * Used during liquidation to convert seized collateral to SOL for treasury
 */
export async function executeSwap(
  inputMint: string,
  inputAmount: bigint,
  vaultAddress: string,
  slippageBps: number = LIQUIDATION_SLIPPAGE_BPS
): Promise<SwapResult> {
  const connection = getConnection();
  const admin = getAdminKeypair();
  
  try {
    // Step 1: Get quote
    const quote = await getSwapQuote(inputMint, inputAmount, slippageBps);
    
    if (!quote) {
      return {
        success: false,
        inputAmount,
        outputAmount: 0n,
        priceImpactPct: 0,
        error: 'Failed to get swap quote',
      };
    }

    console.log(`[JupiterSwap] Quote received:`);
    console.log(`  Input: ${inputAmount} (${inputMint.slice(0, 8)}...)`);
    console.log(`  Output: ${quote.outAmount} SOL`);
    console.log(`  Price Impact: ${quote.priceImpactPct}%`);

    // Alert if price impact is high
    const priceImpact = parseFloat(quote.priceImpactPct);
    if (priceImpact > 5) { // >5% price impact
      await securityMonitor.log({
        severity: priceImpact > 10 ? 'CRITICAL' : 'HIGH',
        category: 'Liquidation',
        eventType: SECURITY_EVENT_TYPES.LIQUIDATION_SLIPPAGE_EXCEEDED,
        message: `High price impact on liquidation swap: ${priceImpact.toFixed(2)}%`,
        details: {
          inputMint,
          inputAmount: inputAmount.toString(),
          expectedOutput: quote.outAmount,
          priceImpactPct: priceImpact,
        },
        source: 'jupiter-swap',
      });
    }

    if (DRY_RUN_MODE) {
      console.log('[JupiterSwap] DRY RUN - Swap not executed');
      return {
        success: true,
        txSignature: 'DRY_RUN_' + Date.now(),
        inputAmount,
        outputAmount: BigInt(quote.outAmount),
        priceImpactPct: parseFloat(quote.priceImpactPct),
      };
    }

    // Step 2: Get swap transaction
    const swapResponse = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: admin.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 'auto',
        asLegacyTransaction: false,
        dynamicComputeUnitLimit: true,
      }),
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.text();
      console.error('[JupiterSwap] Swap API error:', error);
      return {
        success: false,
        inputAmount,
        outputAmount: 0n,
        priceImpactPct: parseFloat(quote.priceImpactPct),
        error: `Swap API error: ${error}`,
      };
    }

    const swapData = await swapResponse.json() as any;
    const { swapTransaction } = swapData;

    // Step 3: Deserialize and sign transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    
    transaction.sign([admin]);

    // Step 4: Send and confirm transaction
    const txSignature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    console.log(`[JupiterSwap] Transaction sent: ${txSignature}`);

    // Step 5: Confirm transaction
    const confirmation = await connection.confirmTransaction(txSignature, 'confirmed');

    if (confirmation.value.err) {
      console.error('[JupiterSwap] Transaction failed:', confirmation.value.err);
      return {
        success: false,
        txSignature,
        inputAmount,
        outputAmount: 0n,
        priceImpactPct: parseFloat(quote.priceImpactPct),
        error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
      };
    }

    // Step 6: Get actual output amount from transaction
    const actualOutputAmount = await getActualSwapOutput(connection, txSignature, admin.publicKey);

    console.log(`[JupiterSwap] Swap successful!`);
    console.log(`  TX: ${txSignature}`);
    console.log(`  Expected output: ${quote.outAmount}`);
    console.log(`  Actual output: ${actualOutputAmount}`);

    return {
      success: true,
      txSignature,
      inputAmount,
      outputAmount: actualOutputAmount,
      priceImpactPct: parseFloat(quote.priceImpactPct),
    };

  } catch (error: any) {
    console.error('[JupiterSwap] Swap execution failed:', error.message);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_FAILED,
      message: `Jupiter swap failed during liquidation: ${error.message}`,
      details: {
        inputMint,
        inputAmount: inputAmount.toString(),
        error: error.message,
      },
      source: 'jupiter-swap',
    });

    return {
      success: false,
      inputAmount,
      outputAmount: 0n,
      priceImpactPct: 0,
      error: error.message,
    };
  }
}

/**
 * Parse transaction to get actual SOL output from swap
 */
async function getActualSwapOutput(
  connection: Connection,
  txSignature: string,
  walletPubkey: PublicKey
): Promise<bigint> {
  try {
    // Wait a bit for transaction to be fully processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    const tx = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      console.warn('[JupiterSwap] Could not fetch transaction details');
      return 0n;
    }

    // Find wallet's SOL balance change
    const accountKeys = tx.transaction.message.getAccountKeys();
    const walletIndex = accountKeys.staticAccountKeys.findIndex(
      key => key.equals(walletPubkey)
    );

    if (walletIndex === -1) {
      console.warn('[JupiterSwap] Wallet not found in transaction');
      return 0n;
    }

    const preBalance = tx.meta.preBalances[walletIndex];
    const postBalance = tx.meta.postBalances[walletIndex];
    
    // Account for transaction fees
    const fee = tx.meta.fee;
    const balanceChange = postBalance - preBalance + fee;

    // If positive, wallet received SOL (swap output)
    if (balanceChange > 0) {
      return BigInt(balanceChange);
    }

    // If negative or zero, something went wrong
    console.warn(`[JupiterSwap] Unexpected balance change: ${balanceChange}`);
    return 0n;

  } catch (error: any) {
    console.error('[JupiterSwap] Failed to parse swap output:', error.message);
    return 0n;
  }
}

/**
 * Estimate swap output without executing (for UI/preview)
 */
export async function estimateSwapOutput(
  inputMint: string,
  inputAmount: bigint
): Promise<{ outputAmount: bigint; priceImpactPct: number } | null> {
  const quote = await getSwapQuote(inputMint, inputAmount);
  
  if (!quote) {
    return null;
  }

  return {
    outputAmount: BigInt(quote.outAmount),
    priceImpactPct: parseFloat(quote.priceImpactPct),
  };
}