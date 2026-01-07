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
    import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
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

      // Debug logging (uncomment when debugging)
      // console.log('=== Wallet Token Debug ===');
      // console.log('Total token accounts:', tokenAccounts.value.length);

      // Filter for PumpFun tokens (mint ends with "pump")
      const pumpTokens: WalletToken[] = [];
      
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (!parsedInfo) continue;

        const mint = parsedInfo.mint;
        const tokenAmount = parsedInfo.tokenAmount;
        const balance = tokenAmount.amount;
        const isPump = mint.toLowerCase().endsWith('pump');

        // Debug individual tokens (uncomment when debugging)
        // console.log(`Token: ${mint.slice(0,8)}... | Balance: ${balance} | isPump: ${isPump} | decimals: ${tokenAmount.decimals} | uiAmount: ${tokenAmount.uiAmountString || tokenAmount.uiAmount}`);

        // Check if this is a PumpFun token
        if (isPump) {
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

      // Debug results (uncomment when debugging)
      // console.log('PumpFun tokens found:', pumpTokens.length);
      // console.log('PumpFun tokens:', pumpTokens.map(t => ({
      //   mint: t.mint.slice(0, 8) + '...',
      //   balance: t.balance,
      //   uiBalance: t.uiBalance,
      //   decimals: t.decimals
      // })));
      
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