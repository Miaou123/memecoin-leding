import { createSignal, createMemo, createEffect, Accessor } from 'solid-js';
import { useWallet } from '@/components/wallet/WalletProvider';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createConnection } from '../utils/rpc';

interface UseTokenBalanceResult {
  balance: Accessor<string | null>;
  uiBalance: Accessor<string | null>;
  decimals: Accessor<number>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  refetch: () => Promise<void>;
}

export function useTokenBalance(tokenMint: Accessor<string | null>): UseTokenBalanceResult {
  const wallet = useWallet();
  const [balance, setBalance] = createSignal<string | null>(null);
  const [decimals, setDecimals] = createSignal<number>(9);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Create a connection instance using the proxy
  const connection = createConnection('confirmed');

  const uiBalance = createMemo(() => {
    const bal = balance();
    const dec = decimals();
    if (!bal) return null;
    
    const balanceNum = parseFloat(bal);
    const divisor = Math.pow(10, dec);
    return (balanceNum / divisor).toString();
  });

  const fetchBalance = async () => {
    const mint = tokenMint();
    const publicKey = wallet.publicKey();

    if (!mint || !publicKey) {
      setBalance(null);
      setError(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const mintPublicKey = new PublicKey(mint);
      const walletPublicKey = new PublicKey(publicKey);

      // PumpFun tokens use Token-2022 program
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      const isPumpToken = mint.toLowerCase().endsWith('pump');
      const tokenProgramId = isPumpToken ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

      // Get the associated token address with the correct program
      const tokenAddress = await getAssociatedTokenAddress(
        mintPublicKey,
        walletPublicKey,
        false, // allowOwnerOffCurve
        tokenProgramId
      );

      // Try to get the token account
      try {
        const tokenAccount = await getAccount(connection, tokenAddress, 'confirmed', tokenProgramId);
        setBalance(tokenAccount.amount.toString());
        
        // Get actual decimals from the token account or mint info
        const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
        const parsedData = mintInfo.value?.data;
        if (parsedData && 'parsed' in parsedData) {
          setDecimals(parsedData.parsed.info.decimals || 6);
        } else {
          setDecimals(6); // Default to 6 for PumpFun tokens
        }
      } catch (accountError: any) {
        // Token account doesn't exist, balance is 0
        if (accountError.name === 'TokenAccountNotFoundError' || 
            accountError.message?.includes('could not find account')) {
          setBalance('0');
          setDecimals(6); // Default to 6 for PumpFun tokens
        } else {
          throw accountError;
        }
      }
    } catch (err: any) {
      console.error('Error fetching token balance:', err);
      setError(err.message || 'Failed to fetch token balance');
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-fetch when token mint or wallet changes
  createEffect(() => {
    fetchBalance();
  });

  return {
    balance,
    uiBalance,
    decimals,
    isLoading,
    error,
    refetch: fetchBalance,
  };
}