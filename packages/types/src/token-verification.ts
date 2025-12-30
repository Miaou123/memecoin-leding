import { TokenTier } from './protocol';

export interface TokenVerificationResult {
  isValid: boolean;
  mint: string;
  symbol?: string;
  name?: string;
  liquidity: number;
  dexId?: 'pumpfun' | 'pumpswap' | 'raydium' | 'orca' | string;
  pairAddress?: string;
  tier?: TokenTier;
  ltvBps?: number;
  reason?: string;
  verifiedAt?: number;
  isWhitelisted?: boolean;
  whitelistSource?: 'manual' | 'auto';
  whitelistReason?: string;
}

export interface PumpFunTokenInfo {
  mint: string;
  symbol: string;
  name: string;
  liquidity: number;
  volume24h: number;
  priceUsd: string;
  fdv: number;
  pairAddress: string;
  dexId: string;
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs?: DexScreenerPair[];
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
}

export interface TokenVerificationCache {
  [mint: string]: {
    result: TokenVerificationResult;
    timestamp: number;
  };
}

export interface VerifyTokenRequest {
  mint: string;
}

export interface GetPumpFunTokensRequest {
  minLiquidity?: number;
  limit?: number;
}

export interface GetPumpFunTokensResponse {
  tokens: TokenVerificationResult[];
  total: number;
}

export interface CanCreateLoanResponse {
  allowed: boolean;
  reason?: string;
  tier?: string;
}