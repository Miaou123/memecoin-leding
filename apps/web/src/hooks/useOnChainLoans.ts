import { useCallback, useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

// Constants
const PROGRAM_ID = new PublicKey('2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S');

// Account offsets (after 8-byte discriminator)
const BORROWER_OFFSET = 8;
const TOKEN_MINT_OFFSET = 40;
const COLLATERAL_AMOUNT_OFFSET = 72;
const SOL_BORROWED_OFFSET = 80;
const ENTRY_PRICE_OFFSET = 88;
const LIQUIDATION_PRICE_OFFSET = 96;
const CREATED_AT_OFFSET = 104;
const DUE_AT_OFFSET = 112;
const STATUS_OFFSET = 120;
const INDEX_OFFSET = 121;

export enum LoanStatus {
  Active = 0,
  Repaid = 1,
  LiquidatedPrice = 2,
  LiquidatedTime = 3,
}

export interface OnChainLoan {
  pubkey: string;
  borrower: string;
  tokenMint: string;
  collateralAmount: string;
  solBorrowed: string;
  entryPrice: string;
  liquidationPrice: string;
  createdAt: number;
  dueAt: number;
  status: LoanStatus;
  index: number;
}

// Parse loan account buffer
function parseLoanAccount(pubkey: PublicKey, data: Buffer): OnChainLoan {
  return {
    pubkey: pubkey.toString(),
    borrower: new PublicKey(data.slice(BORROWER_OFFSET, BORROWER_OFFSET + 32)).toString(),
    tokenMint: new PublicKey(data.slice(TOKEN_MINT_OFFSET, TOKEN_MINT_OFFSET + 32)).toString(),
    collateralAmount: data.readBigUInt64LE(COLLATERAL_AMOUNT_OFFSET).toString(),
    solBorrowed: data.readBigUInt64LE(SOL_BORROWED_OFFSET).toString(),
    entryPrice: data.readBigUInt64LE(ENTRY_PRICE_OFFSET).toString(),
    liquidationPrice: data.readBigUInt64LE(LIQUIDATION_PRICE_OFFSET).toString(),
    createdAt: Number(data.readBigInt64LE(CREATED_AT_OFFSET)),
    dueAt: Number(data.readBigInt64LE(DUE_AT_OFFSET)),
    status: data.readUInt8(STATUS_OFFSET) as LoanStatus,
    index: Number(data.readBigUInt64LE(INDEX_OFFSET)),
  };
}

// Fetch all loans for a borrower from blockchain
export async function fetchLoansFromChain(
  connection: Connection,
  borrower: PublicKey
): Promise<OnChainLoan[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: BORROWER_OFFSET,
          bytes: borrower.toBase58(),
        },
      },
    ],
  });

  return accounts.map(({ pubkey, account }) => 
    parseLoanAccount(pubkey, account.data as Buffer)
  );
}

// Sync missing loans to backend
export async function syncMissingLoans(
  onChainLoans: OnChainLoan[],
  backendLoans: { id: string }[],
  borrower: string
): Promise<{ synced: number; errors: string[] }> {
  const backendIds = new Set(backendLoans.map(l => l.id));
  const missing = onChainLoans.filter(l => 
    l.status === LoanStatus.Active && !backendIds.has(l.pubkey)
  );

  let synced = 0;
  const errors: string[] = [];

  for (const loan of missing) {
    try {
      const res = await fetch('/api/loans/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanPubkey: loan.pubkey,
          txSignature: '',
          borrower,
          tokenMint: loan.tokenMint,
        }),
      });
      if (res.ok) synced++;
      else {
        const err = await res.json();
        if (!err.error?.includes('Unique constraint')) {
          errors.push(err.error);
        }
      }
    } catch (e: any) {
      errors.push(e.message);
    }
  }

  return { synced, errors };
}

// Main hook
export function useOnChainLoans(connection: Connection | null) {
  const { publicKey } = useWallet();
  const [loans, setLoans] = useState<OnChainLoan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors: string[] } | null>(null);

  const fetchLoans = useCallback(async () => {
    if (!connection || !publicKey) return;
    setIsLoading(true);
    try {
      const result = await fetchLoansFromChain(connection, publicKey);
      setLoans(result);
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey]);

  const syncLoans = useCallback(async (backendLoans: { id: string }[]) => {
    if (!publicKey || !loans.length) return { synced: 0, errors: [] };
    const result = await syncMissingLoans(loans, backendLoans, publicKey.toString());
    setSyncResult(result);
    return result;
  }, [publicKey, loans]);

  const fetchAndSync = useCallback(async (backendLoans: { id: string }[]) => {
    if (!connection || !publicKey) return;
    setIsLoading(true);
    try {
      const onChain = await fetchLoansFromChain(connection, publicKey);
      setLoans(onChain);
      if (onChain.length > 0) {
        const result = await syncMissingLoans(onChain, backendLoans, publicKey.toString());
        setSyncResult(result);
        return result;
      }
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (publicKey && connection) fetchLoans();
    else setLoans([]);
  }, [publicKey, connection, fetchLoans]);

  return {
    onChainLoans: loans,
    activeLoans: loans.filter(l => l.status === LoanStatus.Active),
    isLoading,
    syncResult,
    fetchLoans,
    syncLoans,
    fetchAndSync,
  };
}