import { PublicKey } from '@solana/web3.js';

// Program constants
export const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'CD2sN1enC22Nyw6U6s2dYcxfbtsLVq2PhbomLBkyh1z5');
export const PROTOCOL_SEED = Buffer.from('protocol_state');
export const TREASURY_SEED = Buffer.from('treasury');
export const TOKEN_CONFIG_SEED = Buffer.from('token_config');
export const LOAN_SEED = Buffer.from('loan');

// Protocol parameters
export const LOAN_DURATION = {
  MIN_SECONDS: 12 * 60 * 60,      // 12 hours
  MAX_SECONDS: 7 * 24 * 60 * 60,  // 7 days
  DEFAULT_SECONDS: 24 * 60 * 60,  // 24 hours
};

export const MAX_LOAN_DURATION = LOAN_DURATION.MAX_SECONDS;
export const MIN_LOAN_DURATION = LOAN_DURATION.MIN_SECONDS;
export const PROTOCOL_FEE_BPS = 200; // 2%
export const LIQUIDATION_THRESHOLD_BPS = 50; // 0.5% buffer for liquidations

// Fee distribution (for liquidations)
export const FEE_DISTRIBUTION = {
  TREASURY_BPS: 9000, // 90%
  BUYBACK_BPS: 500,   // 5%
  OPERATIONS_BPS: 500, // 5%
};

// Interest rates by tier (in basis points)
export const INTEREST_RATES = {
  BRONZE: {
    MIN_BPS: 500,  // 5%
    MAX_BPS: 1000, // 10%
  },
  SILVER: {
    MIN_BPS: 300,  // 3%
    MAX_BPS: 700,  // 7%
  },
  GOLD: {
    MIN_BPS: 200,  // 2%
    MAX_BPS: 500,  // 5%
  },
};

// LTV ratios by tier (in basis points)
export const LTV_RATIOS = {
  BRONZE: 5000, // 50%
  SILVER: 6000, // 60%
  GOLD: 7000,   // 70%
};

// Liquidation bonuses by tier (in basis points)
export const LIQUIDATION_BONUSES = {
  BRONZE: 1000, // 10%
  SILVER: 750,  // 7.5%
  GOLD: 500,    // 5%
};

// API endpoints
export const API_ENDPOINTS = {
  MAINNET: process.env.API_URL || 'https://api.memecoin-lending.com',
  DEVNET: 'https://api-devnet.memecoin-lending.com',
  LOCALNET: 'http://localhost:3001',
  DEFAULT_API_BASE_URL: 'http://localhost:3001',
};

// WebSocket endpoints
export const WS_ENDPOINTS = {
  MAINNET: process.env.WS_URL || 'wss://api.memecoin-lending.com/ws',
  DEVNET: 'wss://api-devnet.memecoin-lending.com/ws',
  LOCALNET: 'ws://localhost:3001/ws',
};

// PumpFun Program IDs
export const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMPSWAP_PROGRAM_ID = new PublicKey('PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP'); // If needed

// DEX Program IDs (for reference)
export const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
export const ORCA_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');

// Staking configuration
export const STAKING_TOKEN_MINT = process.env.STAKING_TOKEN_MINT || process.env.VITE_STAKING_TOKEN_MINT || '';

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  PRICE: 10,
  TOKEN_CONFIG: 300,
  PROTOCOL_STATE: 30,
  USER_LOANS: 5,
};