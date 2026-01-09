import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import { prepareLoan, PrepareLoanRequest } from '../services/loan-api';
import { fastConfirmTransaction } from './transaction-utils';

export interface CreateLoanParams {
  tokenMint: string;
  collateralAmount: string; // In base units with decimals
  durationSeconds: number;
  borrower: string;
}

export interface CreateLoanResult {
  signature: string;
  loanPda: string;
  solAmount: string;
  price: string;
}

/**
 * Track the loan in the backend database
 */
async function trackLoan(params: {
  loanPubkey: string;
  txSignature: string;
  borrower: string;
  tokenMint: string;
}): Promise<void> {
  try {
    const response = await fetch('/api/loans/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('[CreateLoan] Failed to track loan:', error);
    } else {
      console.log('[CreateLoan] Loan tracked successfully');
    }
  } catch (error) {
    console.error('[CreateLoan] Error tracking loan:', error);
  }
}

/**
 * Creates a loan by:
 * 1. Getting a pre-signed transaction from the backend
 * 2. Having the user sign it
 * 3. Submitting to the network
 * 4. Tracking the loan in the database
 */
export async function createLoan(
  params: CreateLoanParams,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  connection: Connection
): Promise<CreateLoanResult> {
  console.log('[CreateLoan] Preparing transaction...');
  
  // 1. Get pre-signed transaction from backend
  const prepareResponse = await prepareLoan({
    tokenMint: params.tokenMint,
    collateralAmount: params.collateralAmount,
    durationSeconds: params.durationSeconds,
    borrower: params.borrower,
  });

  // Check if price is still valid
  const now = Math.floor(Date.now() / 1000);
  if (now >= prepareResponse.expiresAt) {
    throw new Error('Price expired. Please try again.');
  }

  console.log('[CreateLoan] Got pre-signed transaction');
  console.log(`[CreateLoan] Price: ${prepareResponse.priceInSol} SOL`);
  console.log(`[CreateLoan] Expires in: ${prepareResponse.expiresAt - now}s`);

  // 2. Deserialize the transaction
  const txBuffer = Buffer.from(prepareResponse.transaction, 'base64');
  const transaction = Transaction.from(txBuffer);

  // Get blockhash from the transaction (set by backend)
  const blockhash = transaction.recentBlockhash;
  if (!blockhash) {
    throw new Error('Transaction missing blockhash');
  }

  // 3. User signs the transaction
  console.log('[CreateLoan] Requesting user signature...');
  const signedTx = await signTransaction(transaction);

  // 4. Get lastValidBlockHeight for proper confirmation
  const { lastValidBlockHeight } = await connection.getLatestBlockhash();
  
  // 5. Send to network
  console.log('[CreateLoan] Sending transaction...');
  const rawTransaction = signedTx.serialize();
  
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  console.log(`[CreateLoan] Transaction sent: ${signature}`);

  // 6. Confirm transaction using fast polling
  let confirmed = false;
  let txError: Error | null = null;
  
  const confirmationResult = await fastConfirmTransaction(connection, signature, {
    timeoutMs: 30000,
    pollIntervalMs: 500,
    commitment: 'confirmed',
    onStatusChange: (status) => {
      console.log(`[CreateLoan] Status: ${status}`);
    }
  });
  
  if (confirmationResult.confirmed) {
    confirmed = true;
    console.log(`[CreateLoan] Transaction confirmed in ${confirmationResult.confirmationTime}ms!`);
  } else {
    txError = confirmationResult.error || new Error('Transaction confirmation failed');
    console.error('[CreateLoan] Transaction failed:', txError.message);
  }

  // 7. ALWAYS try to track the loan if we got a signature (even on timeout)
  // This ensures the loan shows up in the database
  if (signature && !txError) {
    console.log('[CreateLoan] Tracking loan in database...');
    await trackLoan({
      loanPubkey: prepareResponse.loanPda,
      txSignature: signature,
      borrower: params.borrower,
      tokenMint: params.tokenMint,
    });
  }

  // 8. Throw error if transaction actually failed
  if (txError) {
    throw txError;
  }

  return {
    signature,
    loanPda: prepareResponse.loanPda,
    solAmount: prepareResponse.estimatedSolAmount,
    price: prepareResponse.price,
  };
}