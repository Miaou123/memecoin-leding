import { TokenTier, PoolType } from '@memecoin-lending/types';

export interface TokenDefinition {
  mint: string;
  symbol: string;
  name: string;
  tier: TokenTier;
  poolAddress: string;
  poolType: PoolType;
  decimals: number;
  logoUrl?: string;
}

export interface TokenMetadata {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tier: TokenTier;
  poolAddress?: string;
  poolType?: PoolType;
  coingeckoId?: string;
  logoURI?: string;
}

// Token definitions with pool configuration
export const TOKEN_DEFINITIONS: Record<string, TokenDefinition> = {
  // Gold Tier - Established memecoins
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    tier: TokenTier.Gold,
    poolAddress: 'Aqk7F6BhrSJSKVAKKdBmHrFEUH3YnKUDWByJKHmfCLBn',
    poolType: PoolType.Raydium,
    logoUrl: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
  },
};

// Default whitelisted tokens (mainnet) - legacy format
export const WHITELISTED_TOKENS: Record<string, TokenMetadata> = {
  // Gold Tier - Established memecoins
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    tier: TokenTier.Gold,
    poolAddress: 'Aqk7F6BhrSJSKVAKKdBmHrFEUH3YnKUDWByJKHmfCLBn',
    poolType: PoolType.Raydium,
    coingeckoId: 'bonk',
    logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
  },
  '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC': {
    mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC',
    symbol: 'POPCAT',
    name: 'Popcat',
    decimals: 9,
    tier: TokenTier.Gold,
    logoURI: 'https://cf-ipfs.com/ipfs/QmNrLNqWvQ4G7M3MrKz6C6hqgBqYsLkfyTdJj8pPh9xBau',
  },
  'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5': {
    mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
    symbol: 'MEW',
    name: 'cat in a dogs world',
    decimals: 5,
    tier: TokenTier.Gold,
  },
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk': {
    mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
    symbol: 'WEN',
    name: 'Wen',
    decimals: 5,
    tier: TokenTier.Gold,
    poolType: PoolType.Raydium,
    coingeckoId: 'wen-4',
  },
  
  // Silver Tier - Growing memecoins
  'CULLsLZjKYZLPdTu8ezT7WgHW1KUDbJGb9yBvsCqCgvf': {
    mint: 'CULLsLZjKYZLPdTu8ezT7WgHW1KUDbJGb9yBvsCqCgvf',
    symbol: 'SILLY',
    name: 'Silly Dragon',
    decimals: 9,
    tier: TokenTier.Silver,
  },
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': {
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    symbol: 'POPCOIN',
    name: 'PopDog',
    decimals: 9,
    tier: TokenTier.Silver,
  },
  
  // Bronze Tier - New/risky memecoins
  // Add bronze tier tokens as needed
};

// Token configuration helpers
export const getTokenByMint = (mint: string): TokenMetadata | undefined => {
  return WHITELISTED_TOKENS[mint];
};

export const getTokensByTier = (tier: TokenTier): TokenMetadata[] => {
  return Object.values(WHITELISTED_TOKENS).filter(token => token.tier === tier);
};

export const getAllTokens = (): TokenMetadata[] => {
  return Object.values(WHITELISTED_TOKENS);
};

// Pool addresses for price feeds (Raydium/Orca)
// Pool addresses for price feeds (Raydium/Orca)
export const TOKEN_POOL_ADDRESSES: Record<string, string> = {
  // BONK/SOL Raydium pool
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'Aqk7F6BhrSJSKVAKKdBmHrFEUH3YnKUDWByJKHmfCLBn',
  // Add other pool addresses as needed
};

// Get token definition by mint
export const getTokenDefinition = (mint: string): TokenDefinition | undefined => {
  return TOKEN_DEFINITIONS[mint];
};

// Get all token definitions
export const getAllTokenDefinitions = (): TokenDefinition[] => {
  return Object.values(TOKEN_DEFINITIONS);
};

// Get token definitions by tier
export const getTokenDefinitionsByTier = (tier: TokenTier): TokenDefinition[] => {
  return Object.values(TOKEN_DEFINITIONS).filter(token => token.tier === tier);
};