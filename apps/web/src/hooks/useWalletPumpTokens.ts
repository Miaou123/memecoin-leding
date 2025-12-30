import { createSignal, createEffect, Accessor } from 'solid-js';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export interface WalletToken {
  mint: string;
  balance: string;
  uiBalance: string;
  decimals: number;
}

interface UseWalletPumpTokensResult {
  tokens: Accessor<WalletToken[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  refetch: () => Promise<void>;
}

export function useWalletPumpTokens(): UseWalletPumpTokensResult {
  const wallet = useWallet();
  const [tokens, setTokens] = createSignal<WalletToken[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Create a connection instance
  const connection = new Connection(
    import.meta.env.VITE_SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=',
    'confirmed'
  );

  const fetchTokens = async () => {
    const publicKey = wallet.publicKey();

    if (!publicKey) {
      setTokens([]);
      setError(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const walletPublicKey = new PublicKey(publicKey);

      // Get all token accounts for the wallet
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

      // Filter for PumpFun tokens (mint ends with "pump")
      const pumpTokens: WalletToken[] = [];
      
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (!parsedInfo) continue;

        const mint = parsedInfo.mint;
        const tokenAmount = parsedInfo.tokenAmount;

        // Check if this is a PumpFun token
        if (mint.toLowerCase().endsWith('pump')) {
          const balance = tokenAmount.amount;
          const decimals = tokenAmount.decimals;
          const uiAmount = tokenAmount.uiAmountString || tokenAmount.uiAmount?.toString() || '0';

          // Only include tokens with non-zero balance
          if (balance !== '0') {
            pumpTokens.push({
              mint,
              balance,
              uiBalance: uiAmount,
              decimals,
            });
          }
        }
      }

      setTokens(pumpTokens);
    } catch (err: any) {
      console.error('Error fetching wallet tokens:', err);
      setError(err.message || 'Failed to fetch wallet tokens');
      setTokens([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-fetch when wallet changes
  createEffect(() => {
    fetchTokens();
  });

  return {
    tokens,
    isLoading,
    error,
    refetch: fetchTokens,
  };
}