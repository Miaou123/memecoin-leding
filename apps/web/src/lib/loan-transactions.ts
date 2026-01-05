import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import { prepareLoan, PrepareLoanRequest } from '../services/loan-api';

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
 * Creates a loan by:
 * 1. Getting a pre-signed transaction from the backend
 * 2. Having the user sign it
 * 3. Submitting to the network
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

  // 3. User signs the transaction
  console.log('[CreateLoan] Requesting user signature...');
  const signedTx = await signTransaction(transaction);

  // 4. Send to network
  console.log('[CreateLoan] Sending transaction...');
  const rawTransaction = signedTx.serialize();
  
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  console.log(`[CreateLoan] Transaction sent: ${signature}`);

  // 5. Confirm transaction
  const confirmation = await connection.confirmTransaction(signature, 'confirmed');
  
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log('[CreateLoan] Transaction confirmed!');

  return {
    signature,
    loanPda: prepareResponse.loanPda,
    solAmount: prepareResponse.estimatedSolAmount,
    price: prepareResponse.price,
  };
}