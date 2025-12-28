import { PublicKey } from '@solana/web3.js';

// Program constants
export const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'MCLend1111111111111111111111111111111111111');
export const PROTOCOL_SEED = Buffer.from('protocol_state');
export const TREASURY_SEED = Buffer.from('treasury');
export const TOKEN_CONFIG_SEED = Buffer.from('token_config');
export const LOAN_SEED = Buffer.from('loan');

// Protocol parameters
export const MAX_LOAN_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
export const MIN_LOAN_DURATION = 12 * 60 * 60; // 12 hours in seconds
export const PROTOCOL_FEE_BPS = 100; // 1%
export const LIQUIDATION_THRESHOLD_BPS = 50; // 0.5% buffer for liquidations

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
};

// WebSocket endpoints
export const WS_ENDPOINTS = {
  MAINNET: process.env.WS_URL || 'wss://api.memecoin-lending.com/ws',
  DEVNET: 'wss://api-devnet.memecoin-lending.com/ws',
  LOCALNET: 'ws://localhost:3001/ws',
};

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  PRICE: 10,
  TOKEN_CONFIG: 300,
  PROTOCOL_STATE: 30,
  USER_LOANS: 5,
};