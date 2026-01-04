import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenVerificationResult } from '@memecoin-lending/types';

interface UseTokenVerificationResult {
  isLoading: boolean;
  isValid: boolean | null;
  data: TokenVerificationResult | null;
  error: string | null;
  refetch: () => Promise<void>;
  isValidating: boolean;
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

export function useTokenVerification(mint: string): UseTokenVerificationResult {
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [data, setData] = useState<TokenVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const verifyToken = useCallback(async (mintToVerify: string, forceRefresh = false) => {
    if (!mintToVerify.trim()) {
      setData(null);
      setError(null);
      setIsLoading(false);
      setIsValidating(false);
      return;
    }

    // Validate mint address format
    if (!isValidMintAddress(mintToVerify)) {
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
      const cachedData = verificationCache[mintToVerify].data;
      setData(cachedData);
      setError(null);
      setIsLoading(false);
      setIsValidating(false);
      return;
    }

    setIsLoading(true);
    setIsValidating(true);
    setError(null);

    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      // Get API endpoint from environment or default
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const apiBase = apiUrl.replace('/api', '');
      
      const response = await fetch(`${apiBase}/api/tokens/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mint: mintToVerify }),
        signal: abortControllerRef.current.signal,
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
  }, []);

  const debouncedVerify = useCallback((mintToVerify: string) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      verifyToken(mintToVerify);
    }, DEBOUNCE_DELAY);
  }, [verifyToken]);

  const refetch = useCallback(async () => {
    if (mint && isValidMintAddress(mint)) {
      await verifyToken(mint, true); // Force refresh
    }
  }, [mint, verifyToken]);

  // Effect to handle mint changes
  useEffect(() => {
    if (mint && mint.trim()) {
      debouncedVerify(mint.trim());
    } else {
      // Clear state for empty mint
      setData(null);
      setError(null);
      setIsLoading(false);
      setIsValidating(false);
    }

    // Cleanup function
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [mint, debouncedVerify]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    isLoading,
    isValid: data?.isValid || null,
    data,
    error,
    refetch,
    isValidating,
  };
}

// Additional hook for batch verification
export function useBatchTokenVerification(mints: string[]) {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TokenVerificationResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const verifyBatch = useCallback(async () => {
    if (!mints.length || mints.length > 10) {
      setResults([]);
      setErrors(mints.length > 10 ? ['Maximum 10 tokens allowed'] : []);
      return;
    }

    // Validate all mint addresses
    const invalidMints = mints.filter(mint => !isValidMintAddress(mint));
    if (invalidMints.length > 0) {
      setErrors([`Invalid mint addresses: ${invalidMints.join(', ')}`]);
      setResults([]);
      return;
    }

    setIsLoading(true);
    setErrors([]);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const apiBase = apiUrl.replace('/api', '');
      
      const response = await fetch(`${apiBase}/api/tokens/batch-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mints }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Batch verification failed');
      }

      setResults(data.data.results);
      
      // Cache individual results
      data.data.results.forEach((result: TokenVerificationResult) => {
        verificationCache[result.mint] = {
          data: result,
          timestamp: Date.now(),
        };
      });
    } catch (err: any) {
      console.error('Batch verification error:', err);
      setErrors([err.message || 'Failed to verify tokens']);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [mints]);

  useEffect(() => {
    if (mints.length > 0) {
      verifyBatch();
    } else {
      setResults([]);
      setErrors([]);
    }
  }, [mints.join(','), verifyBatch]);

  return {
    isLoading,
    results,
    errors,
    refetch: verifyBatch,
  };
}

// Hook for checking loan eligibility
export function useCanCreateLoan(mint: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [canCreate, setCanCreate] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkEligibility = useCallback(async () => {
    if (!mint || !isValidMintAddress(mint)) {
      setCanCreate(null);
      setReason(null);
      setTier(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const apiBase = apiUrl.replace('/api', '');
      
      const response = await fetch(`${apiBase}/api/tokens/${mint}/can-loan`);

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
  }, [mint]);

  useEffect(() => {
    checkEligibility();
  }, [checkEligibility]);

  return {
    isLoading,
    canCreate,
    reason,
    tier,
    error,
    refetch: checkEligibility,
  };
}

// Helper hook to get cached verification data without making requests
export function useCachedTokenVerification(mint: string): TokenVerificationResult | null {
  const [cachedData, setCachedData] = useState<TokenVerificationResult | null>(null);

  useEffect(() => {
    const cached = verificationCache[mint];
    if (cached && isCacheValid(cached)) {
      setCachedData(cached.data);
    } else {
      setCachedData(null);
    }
  }, [mint]);

  return cachedData;
}

// Utility function to clear verification cache (useful for testing or admin actions)
export function clearVerificationCache(mint?: string) {
  if (mint) {
    delete verificationCache[mint];
  } else {
    Object.keys(verificationCache).forEach(key => {
      delete verificationCache[key];
    });
  }
}