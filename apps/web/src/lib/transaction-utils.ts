import { Connection } from '@solana/web3.js';

export interface ConfirmTransactionOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Polling interval in milliseconds (default: 500) */
  pollIntervalMs?: number;
  /** Commitment level (default: 'confirmed') */
  commitment?: 'confirmed' | 'finalized';
  /** Optional callback for status updates */
  onStatusChange?: (status: 'polling' | 'confirmed' | 'failed' | 'timeout') => void;
}

export interface ConfirmTransactionResult {
  confirmed: boolean;
  error?: Error;
  confirmationTime?: number; // ms it took to confirm
}

/**
 * Fast transaction confirmation using polling instead of WebSocket subscriptions.
 * This is much faster than confirmTransaction() when using HTTP-only RPC proxies.
 */
export async function fastConfirmTransaction(
  connection: Connection,
  signature: string,
  options: ConfirmTransactionOptions = {}
): Promise<ConfirmTransactionResult> {
  const {
    timeoutMs = 30000,
    pollIntervalMs = 500,
    commitment = 'confirmed',
    onStatusChange
  } = options;

  const startTime = Date.now();
  console.log(`[TX] Polling for ${signature.slice(0, 8)}...`);
  
  onStatusChange?.('polling');

  while (Date.now() - startTime < timeoutMs) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status.value === null) {
        // Transaction not found yet, keep polling
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        continue;
      }

      // Check for errors
      if (status.value.err) {
        const error = new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        onStatusChange?.('failed');
        console.error(`[TX] Failed: ${signature.slice(0, 8)}...`, status.value.err);
        return { confirmed: false, error };
      }

      // Check confirmation status
      const confirmationStatus = status.value.confirmationStatus;
      if (
        confirmationStatus === 'confirmed' || 
        confirmationStatus === 'finalized' ||
        (commitment === 'confirmed' && confirmationStatus === 'confirmed')
      ) {
        const confirmationTime = Date.now() - startTime;
        onStatusChange?.('confirmed');
        console.log(`[TX] Confirmed in ${confirmationTime}ms: ${signature.slice(0, 8)}...`);
        return { confirmed: true, confirmationTime };
      }

      // Not confirmed yet, continue polling
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      
    } catch (error: any) {
      // Network error - retry a few times before giving up
      console.warn(`[TX] Poll error for ${signature.slice(0, 8)}...:`, error.message);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      
      // If we're close to timeout, return the error
      if (Date.now() - startTime > timeoutMs - 1000) {
        onStatusChange?.('failed');
        return { confirmed: false, error };
      }
    }
  }

  // Timeout reached
  onStatusChange?.('timeout');
  console.warn(`[TX] Timeout after ${timeoutMs}ms: ${signature.slice(0, 8)}...`);
  return { 
    confirmed: false, 
    error: new Error(`Transaction confirmation timeout after ${timeoutMs}ms`)
  };
}

/**
 * Legacy wrapper for backward compatibility with confirmTransaction API
 */
export async function confirmTransactionCompat(
  connection: Connection,
  signature: string,
  commitment: 'confirmed' | 'finalized' = 'confirmed'
): Promise<{ value: { err: any } | null }> {
  const result = await fastConfirmTransaction(connection, signature, { commitment });
  
  if (result.confirmed) {
    return { value: { err: null } };
  } else if (result.error?.message.includes('Transaction failed:')) {
    // Parse the error to extract the original err value
    const errMatch = result.error.message.match(/Transaction failed: (.+)/);
    const err = errMatch ? JSON.parse(errMatch[1]) : 'Unknown error';
    return { value: { err } };
  } else {
    throw result.error || new Error('Transaction confirmation failed');
  }
}