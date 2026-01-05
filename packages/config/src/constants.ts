import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables from root .env file
try {
  // Try to load from various possible locations
  const rootPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '../../../.env'),
    path.join(__dirname, '../../.env'),
    path.join(__dirname, '../.env'),
  ];
  
  for (const envPath of rootPaths) {
    if (fs.existsSync(envPath)) {
      dotenvConfig({ path: envPath });
      break;
    }
  }
} catch (e) {
  // Silently fail if dotenv can't be loaded
}

// Seeds for PDA derivation
const STAKING_POOL_SEED = Buffer.from('staking_pool');
const REWARD_VAULT_SEED = Buffer.from('reward_vault');
const STAKING_VAULT_SEED = Buffer.from('staking_vault');
const PROTOCOL_SEED = Buffer.from('protocol_state');
const TREASURY_SEED = Buffer.from('treasury');
const FEE_RECEIVER_SEED = Buffer.from('fee_receiver');

// Try to load deployment config from JSON
function loadDeploymentConfig(network: string = 'devnet'): { programId: string } | null {
  // In browser, can't read files - use env vars
  if (typeof globalThis !== 'undefined' && (globalThis as any).window !== 'undefined') {
    const programId = (globalThis as any).VITE_PROGRAM_ID || 
                     (typeof process !== 'undefined' && process.env?.VITE_PROGRAM_ID);
    return programId ? { programId } : null;
  }
  
  // In Node.js, try to read the deployment file
  try {
    const possiblePaths = [
      path.join(process.cwd(), 'deployments', `${network}-latest.json`),
      path.join(process.cwd(), '..', 'deployments', `${network}-latest.json`),
      path.join(process.cwd(), '..', '..', 'deployments', `${network}-latest.json`),
      path.join(__dirname, '..', '..', '..', 'deployments', `${network}-latest.json`),
      path.join(__dirname, '..', '..', '..', '..', 'deployments', `${network}-latest.json`),
      // Handle when run from scripts directory
      path.join(process.cwd(), '..', '..', '..', 'deployments', `${network}-latest.json`),
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.programId) {
          return parsed;
        }
      }
    }
  } catch (e) {
    // Silently fail in production, debug in development
    if (process.env.NODE_ENV === 'development') {
      console.debug('Could not load deployment file:', e);
    }
  }
  
  return null;
}

// Get program ID from deployment or env
function getProgramIdForNetwork(network: string = 'devnet'): string {
  // Priority 1: Deployment file
  const deployment = loadDeploymentConfig(network);
  if (deployment?.programId) {
    return deployment.programId;
  }
  
  // Priority 2: Environment variables
  if (process.env.PROGRAM_ID) return process.env.PROGRAM_ID;
  if (process.env.VITE_PROGRAM_ID) return process.env.VITE_PROGRAM_ID;
  
  // Fallback - use known devnet program ID
  // Fallback - use known devnet program ID
  // Silent fallback since deployment files may not be accessible from all contexts
  return 'Ex1UJrdAUqosatT1moQSPTMepfKtnKWKfsKMTjZBeKva';
}

// Current network
function getCurrentNetwork(): string {
  return process.env.SOLANA_NETWORK || process.env.VITE_SOLANA_NETWORK || 'devnet';
}

const currentNetwork = getCurrentNetwork();

// Export program ID
export const PROGRAM_ID = new PublicKey(getProgramIdForNetwork(currentNetwork));

// Export function to get program ID string
export const getProgramId = (network: string = currentNetwork): string => {
  return getProgramIdForNetwork(network);
};

// ============= PDA DERIVATION FUNCTIONS =============
// These derive PDAs from the program ID - NO HARD-CODED ADDRESSES!

export function getStakingPoolPDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STAKING_POOL_SEED], programId);
}

export function getRewardVaultPDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REWARD_VAULT_SEED], programId);
}

export function getStakingVaultPDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STAKING_VAULT_SEED], programId);
}

export function getProtocolStatePDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], programId);
}

export function getTreasuryPDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TREASURY_SEED], programId);
}

export function getFeeReceiverPDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FEE_RECEIVER_SEED], programId);
}

export function getUserStakePDA(
  stakingPool: PublicKey, 
  user: PublicKey, 
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    programId
  );
}

// Legacy export for backwards compatibility - but these now DERIVE, not hard-code
export const getProtocolAddresses = (network: string = currentNetwork) => {
  const programId = new PublicKey(getProgramIdForNetwork(network));
  const [stakingPool] = getStakingPoolPDA(programId);
  const [rewardVault] = getRewardVaultPDA(programId);
  const [stakingVault] = getStakingVaultPDA(programId);
  const [protocolState] = getProtocolStatePDA(programId);
  const [treasury] = getTreasuryPDA(programId);
  const [feeReceiver] = getFeeReceiverPDA(programId);
  
  return {
    stakingPool: stakingPool.toString(),
    rewardVault: rewardVault.toString(),
    stakingVault: stakingVault.toString(),
    protocolState: protocolState.toString(),
    treasury: treasury.toString(),
    feeReceiver: feeReceiver.toString(),
  };
};

// ============= OTHER CONSTANTS (unchanged) =============

// Export seed constants for backwards compatibility
export const PROTOCOL_SEED_BUFFER = PROTOCOL_SEED;
export const TREASURY_SEED_BUFFER = TREASURY_SEED;
export const TOKEN_CONFIG_SEED = Buffer.from('token_config');
export const LOAN_SEED = Buffer.from('loan');

// Export seeds directly (needed by SDK)
export { PROTOCOL_SEED, TREASURY_SEED };

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