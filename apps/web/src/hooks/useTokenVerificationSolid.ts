import { createSignal, createEffect, createMemo, onCleanup } from 'solid-js';
import { TokenVerificationResult } from '@memecoin-lending/types';

interface UseTokenVerificationResult {
  isLoading: () => boolean;
  isValid: () => boolean | null;
  data: () => TokenVerificationResult | null;
  error: () => string | null;
  refetch: () => Promise<void>;
  isValidating: () => boolean;
}

interface TokenVerificationCache {
  [mint: string]: {
    data: TokenVerificationResult;
    timestamp: number;
  };
}

// Global cache for verified tokens (shared across components)
const verificationCache: TokenVerificationCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 300; // 300ms

// Helper function to check if cached data is valid
function isCacheValid(cachedEntry: { timestamp: number }): boolean {
  return Date.now() - cachedEntry.timestamp < CACHE_TTL;
}

// Helper function to validate mint address format
function isValidMintAddress(mint: string): boolean {
  if (!mint || typeof mint !== 'string') return false;
  
  // Basic Solana address validation
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(mint);
}

export function createTokenVerification(mint: () => string): UseTokenVerificationResult {
  const [isLoading, setIsLoading] = createSignal(false);
  const [isValidating, setIsValidating] = createSignal(false);
  const [data, setData] = createSignal<TokenVerificationResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  
  let debounceTimeout: NodeJS.Timeout | undefined;
  let abortController: AbortController | undefined;

  const verifyToken = async (mintToVerify: string, forceRefresh = false) => {
    console.log('[TokenVerificationSolid] verifyToken called with:', mintToVerify.slice(0, 8) + '...', 'forceRefresh:', forceRefresh);
    
    if (!mintToVerify.trim()) {
      console.log('[TokenVerificationSolid] Empty mint, clearing data');
      setData(null);
      setError(null);
      setIsLoading(false);
      setIsValidating(false);
      return;
    }

    // Validate mint address format
    if (!isValidMintAddress(mintToVerify)) {
      console.log('[TokenVerificationSolid] Invalid mint address format:', mintToVerify.slice(0, 8) + '...');
      const invalidResult: TokenVerificationResult = {
        isValid: false,
        mint: mintToVerify,
        liquidity: 0,
        reason: 'Invalid mint address format',
        verifiedAt: Date.now(),
      };
      setData(invalidResult);
      setError('Invalid mint address format');
      setIsLoading(false);
      setIsValidating(false);
      return;
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh && verificationCache[mintToVerify] && isCacheValid(verificationCache[mintToVerify])) {
      console.log('[TokenVerificationSolid] Using cached data for:', mintToVerify.slice(0, 8) + '...');
      const cachedData = verificationCache[mintToVerify].data;
      setData(cachedData);
      setError(null);
      setIsLoading(false);
      setIsValidating(false);
      return;
    }

    console.log('[TokenVerificationSolid] Making API call for:', mintToVerify.slice(0, 8) + '...');

    setIsLoading(true);
    setIsValidating(true);
    setError(null);

    // Cancel previous request if still pending
    if (abortController) {
      abortController.abort();
    }

    // Create new abort controller
    abortController = new AbortController();

    try {
      // Get API endpoint from environment or default
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
      
      const response = await fetch(`${apiBase}/api/tokens/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mint: mintToVerify }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 400) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Invalid request');
        } else if (response.status >= 500) {
          throw new Error('Server error - please try again later');
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      const responseData = await response.json();

      if (!responseData.success) {
        throw new Error(responseData.error || 'Token verification failed');
      }

      const verificationResult: TokenVerificationResult = responseData.data;

      // Cache the result
      verificationCache[mintToVerify] = {
        data: verificationResult,
        timestamp: Date.now(),
      };

      setData(verificationResult);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Request was cancelled, don't update state
        return;
      }

      console.error('Token verification error:', err);
      
      // Check if we have cached data to fall back to
      const fallbackCache = verificationCache[mintToVerify];
      if (fallbackCache) {
        setData(fallbackCache.data);
        setError(`Using cached data: ${err.message}`);
      } else {
        setData(null);
        setError(err.message || 'Failed to verify token');
      }
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  };

  const debouncedVerify = (mintToVerify: string) => {
    // Clear existing timeout
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    // Set new timeout
    debounceTimeout = setTimeout(() => {
      verifyToken(mintToVerify);
    }, DEBOUNCE_DELAY);
  };

  const refetch = async () => {
    const currentMint = mint();
    if (currentMint && isValidMintAddress(currentMint)) {
      await verifyToken(currentMint, true); // Force refresh
    }
  };

  // Effect to handle mint changes
  createEffect(() => {
    const currentMint = mint();
    console.log('[TokenVerificationSolid] Effect triggered, mint:', currentMint?.slice(0, 8) + '...');
    
    if (currentMint && currentMint.trim()) {
      console.log('[TokenVerificationSolid] Starting verification for:', currentMint.slice(0, 8) + '...');
      debouncedVerify(currentMint.trim());
    } else {
      // Clear state for empty mint
      console.log('[TokenVerificationSolid] Clearing state for empty mint');
      setData(null);
      setError(null);
      setIsLoading(false);
      setIsValidating(false);
    }
  });

  // Cleanup on disposal
  onCleanup(() => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    if (abortController) {
      abortController.abort();
    }
  });

  const isValid = createMemo(() => data()?.isValid || null);

  return {
    isLoading,
    isValid,
    data,
    error,
    refetch,
    isValidating,
  };
}

// Helper for checking loan eligibility
export function createCanCreateLoan(mint: () => string) {
  const [isLoading, setIsLoading] = createSignal(false);
  const [canCreate, setCanCreate] = createSignal<boolean | null>(null);
  const [reason, setReason] = createSignal<string | null>(null);
  const [tier, setTier] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const checkEligibility = async () => {
    const currentMint = mint();
    if (!currentMint || !isValidMintAddress(currentMint)) {
      setCanCreate(null);
      setReason(null);
      setTier(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
      
      const response = await fetch(`${apiBase}/api/tokens/${currentMint}/can-loan`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to check loan eligibility');
      }

      setCanCreate(data.data.allowed);
      setReason(data.data.reason);
      setTier(data.data.tier);
    } catch (err: any) {
      console.error('Loan eligibility check error:', err);
      setError(err.message || 'Failed to check loan eligibility');
      setCanCreate(null);
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    checkEligibility();
  });

  const refetch = () => checkEligibility();

  return {
    isLoading,
    canCreate,
    reason,
    tier,
    error,
    refetch,
  };
}

// Utility function to clear verification cache
export function clearVerificationCache(mint?: string) {
  if (mint) {
    delete verificationCache[mint];
  } else {
    Object.keys(verificationCache).forEach(key => {
      delete verificationCache[key];
    });
  }
}