import { getDeploymentConfig, getCurrentNetwork } from '@memecoin-lending/config';

// Cache the deployment config
let cachedDeployment: any = null;
let cachedNetwork: string | null = null;

/**
 * Get deployment configuration for current network
 * This is the single source of truth for all protocol addresses and configuration
 */
export const getDeployment = () => {
  const network = (import.meta.env.VITE_SOLANA_NETWORK || 'devnet') as any;
  
  // Return cached deployment if network hasn't changed
  if (cachedDeployment && cachedNetwork === network) {
    return cachedDeployment;
  }
  
  cachedNetwork = network;
  cachedDeployment = getDeploymentConfig(network);
  return cachedDeployment;
};

/**
 * Get all PDAs from deployment
 */
export const getPDAs = () => {
  const deployment = getDeployment();
  return deployment.pdas || {};
};

/**
 * Get specific PDA address
 */
export const getPDA = (name: keyof ReturnType<typeof getPDAs>): string | undefined => {
  const pdas = getPDAs();
  return pdas[name];
};

/**
 * Get program ID from deployment
 */
export const getProgramId = (): string => {
  const deployment = getDeployment();
  return deployment.programId;
};

/**
 * Get treasury address
 */
export const getTreasuryAddress = (): string => {
  return getPDA('treasury') || '';
};

/**
 * Get protocol state address
 */
export const getProtocolStateAddress = (): string => {
  return getPDA('protocolState') || '';
};

/**
 * Get fee receiver address
 */
export const getFeeReceiverAddress = (): string => {
  return getPDA('feeReceiver') || '';
};

/**
 * Get reward vault address
 */
export const getRewardVaultAddress = (): string => {
  return getPDA('rewardVault') || '';
};

/**
 * Get staking configuration
 */
export const getStakingConfig = () => {
  const deployment = getDeployment();
  return deployment.staking;
};

/**
 * Get staking pool address
 */
export const getStakingPoolAddress = (): string | undefined => {
  const staking = getStakingConfig();
  return staking?.stakingPool;
};

/**
 * Get staking token mint
 */
export const getStakingTokenMint = (): string | undefined => {
  const staking = getStakingConfig();
  return staking?.stakingTokenMint;
};

/**
 * Get whitelisted tokens
 */
export const getWhitelistedTokens = () => {
  const deployment = getDeployment();
  return deployment.tokens?.whitelisted || [];
};