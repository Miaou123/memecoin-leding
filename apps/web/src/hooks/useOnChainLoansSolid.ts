import { createSignal, createEffect, createMemo, onCleanup } from 'solid-js';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWallet } from '@/components/wallet/WalletProvider';

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

// Cache to prevent repeated fetches
const loansCache: Map<string, { loans: OnChainLoan[]; timestamp: number }> = new Map();
const CACHE_TTL_MS = 30_000; // 30 seconds cache

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
function parseLoanAccount(pubkey: PublicKey, data: Buffer): OnChainLoan | null {
  try {
    // Validate minimum data length
    if (data.length < 130) {
      console.warn('[OnChainLoans] Invalid data length:', data.length);
      return null;
    }

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
  } catch (err) {
    console.error('[OnChainLoans] Failed to parse loan:', err);
    return null;
  }
}

// Fetch all loans for a borrower from blockchain
export async function fetchLoansFromChain(
  connection: Connection,
  borrower: PublicKey
): Promise<OnChainLoan[]> {
  const borrowerStr = borrower.toString();
  
  // Check cache first
  const cached = loansCache.get(borrowerStr);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[OnChainLoans] Using cached loans for', borrowerStr.slice(0, 8) + '...');
    return cached.loans;
  }

  console.log('[OnChainLoans] Fetching loans from chain for', borrowerStr.slice(0, 8) + '...');
  
  try {
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

    console.log('[OnChainLoans] Found', accounts.length, 'loan accounts');

    const loans = accounts
      .map(({ pubkey, account }) => parseLoanAccount(pubkey, account.data as Buffer))
      .filter((loan): loan is OnChainLoan => loan !== null);

    // Update cache
    loansCache.set(borrowerStr, { loans, timestamp: Date.now() });

    return loans;
  } catch (err) {
    console.error('[OnChainLoans] Failed to fetch from chain:', err);
    return cached?.loans || [];
  }
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

  console.log('[OnChainLoans] Found', missing.length, 'missing loans to sync');

  if (missing.length === 0) {
    return { synced: 0, errors: [] };
  }

  let synced = 0;
  const errors: string[] = [];
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';

  for (const loan of missing) {
    try {
      const res = await fetch(`${apiUrl}/loans/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanPubkey: loan.pubkey,
          txSignature: '',
          borrower,
          tokenMint: loan.tokenMint,
        }),
      });
      
      if (res.ok) {
        console.log('[OnChainLoans] Synced loan:', loan.pubkey.slice(0, 8) + '...');
        synced++;
      } else {
        const err = await res.json();
        // Ignore "already exists" errors
        if (!err.error?.includes('Unique constraint') && !err.error?.includes('already exists')) {
          errors.push(`${loan.pubkey.slice(0, 8)}: ${err.error}`);
        }
      }
    } catch (e: any) {
      errors.push(`${loan.pubkey.slice(0, 8)}: ${e.message}`);
    }
  }

  return { synced, errors };
}

// Clear cache for a specific borrower or all
export function clearLoansCache(borrower?: string) {
  if (borrower) {
    loansCache.delete(borrower);
  } else {
    loansCache.clear();
  }
}

// Main hook
export function useOnChainLoans(connection: Connection) {
  const wallet = useWallet();
  
  const [loans, setLoans] = createSignal<OnChainLoan[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [syncResult, setSyncResult] = createSignal<{ synced: number; errors: string[] } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  
  // Guards to prevent duplicate fetches
  const [hasFetched, setHasFetched] = createSignal(false);
  const [isFetching, setIsFetching] = createSignal(false);
  const [lastWallet, setLastWallet] = createSignal<string | null>(null);

  const activeLoans = createMemo(() => 
    loans().filter(l => l.status === LoanStatus.Active)
  );

  const fetchLoans = async () => {
    const publicKey = wallet.publicKey();
    
    if (!publicKey || !connection) {
      setLoans([]);
      return;
    }

    // Prevent duplicate fetches
    if (isFetching()) {
      console.log('[OnChainLoans] Already fetching, skipping');
      return;
    }

    setIsFetching(true);
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchLoansFromChain(connection, publicKey);
      setLoans(result);
      setHasFetched(true);
      setLastWallet(publicKey.toString());
    } catch (err: any) {
      console.error('[OnChainLoans] Fetch error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  };

  const syncLoans = async (backendLoans: { id: string }[]) => {
    const publicKey = wallet.publicKey();
    if (!publicKey || loans().length === 0) {
      return { synced: 0, errors: [] };
    }

    const result = await syncMissingLoans(loans(), backendLoans, publicKey.toString());
    setSyncResult(result);
    return result;
  };

  const fetchAndSync = async (backendLoans: { id: string }[]) => {
    const publicKey = wallet.publicKey();
    if (!publicKey || !connection) {
      return null;
    }

    // Prevent duplicate fetches
    if (isFetching()) {
      console.log('[OnChainLoans] Already fetching, skipping fetchAndSync');
      return null;
    }

    setIsFetching(true);
    setIsLoading(true);
    setError(null);

    try {
      const onChain = await fetchLoansFromChain(connection, publicKey);
      setLoans(onChain);
      setHasFetched(true);
      setLastWallet(publicKey.toString());

      if (onChain.length > 0) {
        const result = await syncMissingLoans(onChain, backendLoans, publicKey.toString());
        setSyncResult(result);
        return result;
      }
      
      return { synced: 0, errors: [] };
    } catch (err: any) {
      console.error('[OnChainLoans] FetchAndSync error:', err);
      setError(err.message);
      return null;
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  };

  // Auto-fetch ONLY when wallet changes (not on every render)
  createEffect(() => {
    const publicKey = wallet.publicKey();
    const currentWallet = publicKey?.toString() || null;
    const previousWallet = lastWallet();

    // Only fetch if wallet changed
    if (currentWallet && currentWallet !== previousWallet) {
      console.log('[OnChainLoans] Wallet changed, fetching loans');
      // Use setTimeout to avoid blocking the effect
      setTimeout(() => fetchLoans(), 100);
    } else if (!currentWallet) {
      // Wallet disconnected
      setLoans([]);
      setHasFetched(false);
      setLastWallet(null);
      setSyncResult(null);
    }
  });

  // Cleanup
  onCleanup(() => {
    // Nothing to cleanup currently
  });

  return {
    onChainLoans: loans,
    activeLoans,
    isLoading,
    isSyncing: isFetching, // Alias for compatibility
    syncResult,
    error,
    fetchLoans,
    syncLoans,
    fetchAndSync,
    clearCache: () => clearLoansCache(wallet.publicKey()?.toString()),
  };
}