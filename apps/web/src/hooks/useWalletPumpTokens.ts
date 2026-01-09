import { createSignal, createEffect, Accessor } from 'solid-js';
import { useWallet } from '@/components/wallet/WalletProvider';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createConnection } from '../utils/rpc';
import { api } from '@/lib/api';

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

  // Create a connection instance using the proxy
  const connection = createConnection('confirmed');

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
      let tokenAccounts;
      try {
        console.log('Fetching token accounts for wallet:', publicKey);
        
        // Also check Token-2022 accounts since PumpFun uses Token-2022
        const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
        
        // Fetch both regular SPL tokens and Token-2022 tokens
        const [regularTokens, token2022Accounts] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(walletPublicKey, {
            programId: TOKEN_PROGRAM_ID,
          }),
          connection.getParsedTokenAccountsByOwner(walletPublicKey, {
            programId: TOKEN_2022_PROGRAM_ID,
          })
        ]);
        
        console.log('Regular SPL token accounts:', regularTokens.value.length);
        console.log('Token-2022 accounts:', token2022Accounts.value.length);
        
        // Combine both token types
        tokenAccounts = {
          value: [...regularTokens.value, ...token2022Accounts.value]
        };
        
        console.log('Total token accounts fetched:', tokenAccounts.value.length);
      } catch (rpcError: any) {
        console.error('RPC Error fetching token accounts:', rpcError);
        throw new Error(`Failed to fetch token accounts: ${rpcError.message || 'Unknown RPC error'}`);
      }

      // Debug logging
      console.log('=== Wallet Token Debug ===');
      console.log('Total token accounts:', tokenAccounts.value.length);

      // Filter for PumpFun tokens first (mint ends with "pump")
      const pumpTokens: WalletToken[] = [];
      
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed?.info;
        if (!parsedInfo) continue;

        const mint = parsedInfo.mint;
        const tokenAmount = parsedInfo.tokenAmount;
        const balance = tokenAmount.amount;
        const isPump = mint.toLowerCase().endsWith('pump');

        // Debug individual tokens
        console.log(`Token: ${mint.slice(0,8)}... | Balance: ${balance} | isPump: ${isPump} | decimals: ${tokenAmount.decimals} | uiAmount: ${tokenAmount.uiAmountString || tokenAmount.uiAmount}`);

        // Check if this is a PumpFun token (include all, even with 0 balance)
        if (isPump) {
          const decimals = tokenAmount.decimals;
          const uiAmount = tokenAmount.uiAmountString || tokenAmount.uiAmount?.toString() || '0';
          
          if (balance === '0') {
            console.log(`Including PumpFun token with 0 balance: ${mint}`);
          }
          
          pumpTokens.push({
            mint,
            balance,
            uiBalance: uiAmount,
            decimals,
          });
        }
      }

      // Debug results (uncomment when debugging)
      console.log('PumpFun tokens found:', pumpTokens.length);
      // console.log('PumpFun tokens:', pumpTokens.map(t => ({
      //   mint: t.mint.slice(0, 8) + '...',
      //   balance: t.balance,
      //   uiBalance: t.uiBalance,
      //   decimals: t.decimals
      // })));
      
      // Filter PumpFun tokens against whitelist
      if (pumpTokens.length > 0) {
        try {
          const mints = pumpTokens.map(t => t.mint);
          console.log('Checking whitelist for mints:', mints);
          
          const whitelistResponse = await api.checkWhitelisted(mints);
          console.log('Whitelist response:', whitelistResponse);
          
          // Create a set of whitelisted mints for fast lookup
          const whitelistedSet = new Set(whitelistResponse.whitelistedMints);
          
          // Filter tokens to only include whitelisted ones
          const whitelistedTokens = pumpTokens.filter(token => whitelistedSet.has(token.mint));
          
          console.log(`Found ${whitelistedTokens.length} whitelisted PumpFun tokens out of ${pumpTokens.length} PumpFun tokens`);
          
          setTokens(whitelistedTokens);
        } catch (err) {
          console.error('Error checking whitelist:', err);
          // If whitelist check fails, return all PumpFun tokens (fallback to old behavior)
          console.log('Falling back to showing all PumpFun tokens due to whitelist error');
          setTokens(pumpTokens);
        }
      } else {
        setTokens([]);
      }
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