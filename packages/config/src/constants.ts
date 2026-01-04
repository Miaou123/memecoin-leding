import { PublicKey } from '@solana/web3.js';

// Hard-coded deployment data for current devnet deployment
// TODO: Replace with proper file loading once ESM issues are resolved
const CURRENT_DEPLOYMENT_DATA = {
  programId: "46YbCjkHDPYWWNZZEPsvWeLweFtzmPEeCnDP87zDTZFU",
  network: "devnet",
  pdas: {
    "Protocol State": "Fdy6iz7KxM3i4i8frarTY2GUvhJfyWCBq5VMypUrHjQA",
    "Treasury": "4ApW4miBk8GcDqLGVwqFUssuTJ62Eo1hCFWe13YcgyaG",
    "feeReceiver": "9TS7qCWqARwMx7uCtCyXkLKaMxBRSw4nY4FzWk559LNH",
    "rewardVault": "29Hm7e7E8b2V4Wrrr3crQmdPb3kGgMYWnd935QewwDUq",
    "stakingPool": "RJqhZhEWaWqiFDGJfTBtJeCsANnjRuMmTzC2E9FPqjN",
    "stakingVault": "BARUuKxxQa8uxkPirTpVn4jiiYS2RSwvNkwiUZqYsMFz"
  }
};

// Function to load deployment config
function loadDeployment(network: string = 'devnet') {
  // For now, return hard-coded deployment for devnet
  if (network === 'devnet') {
    console.debug('Using hard-coded deployment config for devnet');
    return CURRENT_DEPLOYMENT_DATA;
  }
  
  // Don't try to load files in browser
  if (typeof globalThis !== 'undefined' && (globalThis as any).window) {
    return null;
  }
  
  // For other networks, return null for now
  console.debug('No deployment config available for network:', network);
  return null;
}

// Function to get program ID with deployment priority
function getProgramIdForNetwork(network: string = 'devnet'): string {
  // First try: deployment artifacts
  const deployment = loadDeployment(network);
  if (deployment?.programId) {
    return deployment.programId;
  }
  
  // Second try: environment variable
  if (process.env.PROGRAM_ID) {
    return process.env.PROGRAM_ID;
  }
  
  // Third try: VITE environment variable (for frontend)
  if (process.env.VITE_PROGRAM_ID) {
    return process.env.VITE_PROGRAM_ID;
  }
  
  // Fallback: hardcoded default
  return 'CD2sN1enC22Nyw6U6s2dYcxfbtsLVq2PhbomLBkyh1z5';
}

// Function to get current network
function getCurrentNetwork(): string {
  return process.env.SOLANA_NETWORK || process.env.VITE_SOLANA_NETWORK || 'devnet';
}

// Program constants
const currentNetwork = getCurrentNetwork();
export const PROGRAM_ID = new PublicKey(getProgramIdForNetwork(currentNetwork));

// Export function to get program ID for any network
export const getProgramId = (network: string = currentNetwork): string => {
  return getProgramIdForNetwork(network);
};

// Export function to get protocol addresses from deployment
export const getProtocolAddresses = (network: string = currentNetwork) => {
  const deployment = loadDeployment(network);
  return deployment?.pdas || {};
};
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


// LTV ratios by tier (in basis points)
export const LTV_RATIOS = {
  BRONZE: 2500, // 25%
  SILVER: 3500, // 35%
  GOLD: 5000,   // 50%
};

// Liquidity thresholds for tier classification (in USD)
export const LIQUIDITY_THRESHOLDS_USD = {
  BRONZE: 0,
  SILVER: 100_000,
  GOLD: 300_000,
};

// Duration-based LTV scaling
export const LTV_SCALING = {
  BASE_DURATION_SECONDS: 48 * 60 * 60,  // 48 hours
  MAX_BONUS_BPS: 2500,                   // +25% for 12h
  MAX_PENALTY_BPS: 2500,                 // -25% for 7d
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