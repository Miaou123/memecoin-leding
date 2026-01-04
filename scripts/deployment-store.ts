#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

export interface TokenConfig {
  mint: string;
  configPda: string;
  symbol?: string;
  name?: string;
  tier: 'bronze' | 'silver' | 'gold';
  whitelistedAt: string;
  txSignature: string;
}

export interface InitializationRecord {
  txSignature: string;
  timestamp: string;
  admin?: string;
  tokenMint?: string;
  targetPoolBalance?: number;
  baseEmissionRate?: number;
  funded?: boolean;
  balance?: number;
}

export interface DeploymentConfig {
  // Basic deployment info
  programId: string;
  network: string;
  deployedAt: string;
  deploySignature?: string;
  idlAccount?: string;
  cluster: string;

  // Protocol PDAs
  pdas: {
    protocolState?: string;
    treasury?: string;
    feeReceiver?: string;
    stakingPool?: string;
    stakingVault?: string;
    rewardVault?: string;
  };

  // Initialization tracking
  initialization: {
    protocol?: InitializationRecord;
    feeReceiver?: InitializationRecord;
    staking?: InitializationRecord;
    treasury?: InitializationRecord;
  };

  // Token whitelist
  tokens: {
    whitelisted: TokenConfig[];
  };

  // Deployment metadata
  metadata?: {
    deployerAddress?: string;
    anchorVersion?: string;
    solanaCliVersion?: string;
    rustcVersion?: string;
  };
}

/**
 * Get the deployment file path for a network
 */
function getDeploymentPath(network: string): string {
  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  return path.join(deploymentsDir, `${network}-latest.json`);
}

/**
 * Load deployment configuration for a network
 */
export function loadDeployment(network: string): DeploymentConfig | null {
  const deploymentPath = getDeploymentPath(network);
  
  if (!fs.existsSync(deploymentPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(deploymentPath, 'utf8');
    const deployment = JSON.parse(content) as DeploymentConfig;
    
    // Ensure all required structures exist
    deployment.pdas = deployment.pdas || {};
    deployment.initialization = deployment.initialization || {};
    deployment.tokens = deployment.tokens || { whitelisted: [] };
    
    return deployment;
  } catch (error) {
    console.warn(`⚠️  Failed to load deployment file: ${deploymentPath}`, error);
    return null;
  }
}

/**
 * Save complete deployment configuration
 */
export function saveDeployment(network: string, config: DeploymentConfig): void {
  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  
  // Create deployments directory if it doesn't exist
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentPath = getDeploymentPath(network);
  
  // Ensure all required structures exist
  config.pdas = config.pdas || {};
  config.initialization = config.initialization || {};
  config.tokens = config.tokens || { whitelisted: [] };
  
  fs.writeFileSync(deploymentPath, JSON.stringify(config, null, 2));
  console.log(`📝 Deployment config saved: ${deploymentPath}`);
}

/**
 * Update deployment configuration with partial data (deep merge)
 */
export function updateDeployment(network: string, updates: Partial<DeploymentConfig>): void {
  const existing = loadDeployment(network) || {
    programId: '',
    network,
    deployedAt: new Date().toISOString(),
    cluster: network === 'mainnet' ? 'mainnet-beta' : network,
    pdas: {},
    initialization: {},
    tokens: { whitelisted: [] }
  };

  // Deep merge function
  const deepMerge = (target: any, source: any): any => {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] !== undefined && source[key] !== null) {
        if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    return result;
  };

  const updated = deepMerge(existing, updates);
  
  // Ensure required structures exist
  updated.pdas = updated.pdas || {};
  updated.initialization = updated.initialization || {};
  updated.tokens = updated.tokens || { whitelisted: [] };

  saveDeployment(network, updated);
}

/**
 * Get specific address from deployment
 */
export function getAddress(network: string, key: keyof DeploymentConfig['pdas']): string | null {
  const deployment = loadDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment found for network: ${network}`);
  }

  return deployment.pdas[key] || null;
}

/**
 * Get all protocol addresses for a network
 */
export function getProtocolAddresses(network: string): DeploymentConfig['pdas'] {
  const deployment = loadDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment found for network: ${network}`);
  }

  return deployment.pdas;
}

/**
 * Check if a component is initialized
 */
export function isInitialized(network: string, component: keyof DeploymentConfig['initialization']): boolean {
  const deployment = loadDeployment(network);
  return !!(deployment?.initialization[component]?.txSignature);
}

/**
 * Get initialization info for a component
 */
export function getInitializationInfo(
  network: string, 
  component: keyof DeploymentConfig['initialization']
): InitializationRecord | null {
  const deployment = loadDeployment(network);
  return deployment?.initialization[component] || null;
}

/**
 * Add a whitelisted token to the deployment
 */
export function addWhitelistedToken(network: string, token: TokenConfig): void {
  const deployment = loadDeployment(network);
  if (!deployment) {
    throw new Error(`No deployment found for network: ${network}`);
  }

  // Check if token already exists
  const existingIndex = deployment.tokens.whitelisted.findIndex(t => t.mint === token.mint);
  
  if (existingIndex >= 0) {
    // Update existing token
    deployment.tokens.whitelisted[existingIndex] = token;
  } else {
    // Add new token
    deployment.tokens.whitelisted.push(token);
  }

  saveDeployment(network, deployment);
}

/**
 * Get whitelisted tokens for a network
 */
export function getWhitelistedTokens(network: string): TokenConfig[] {
  const deployment = loadDeployment(network);
  return deployment?.tokens.whitelisted || [];
}

/**
 * Check if a token is whitelisted
 */
export function isTokenWhitelisted(network: string, mint: string): boolean {
  const tokens = getWhitelistedTokens(network);
  return tokens.some(token => token.mint === mint);
}

/**
 * Get deployment status summary
 */
export function getDeploymentStatus(network: string): {
  deployed: boolean;
  protocolInitialized: boolean;
  feeReceiverInitialized: boolean;
  stakingInitialized: boolean;
  treasuryFunded: boolean;
  whitelistedTokensCount: number;
} {
  const deployment = loadDeployment(network);
  
  if (!deployment) {
    return {
      deployed: false,
      protocolInitialized: false,
      feeReceiverInitialized: false,
      stakingInitialized: false,
      treasuryFunded: false,
      whitelistedTokensCount: 0
    };
  }

  return {
    deployed: !!deployment.programId,
    protocolInitialized: !!deployment.initialization.protocol?.txSignature,
    feeReceiverInitialized: !!deployment.initialization.feeReceiver?.txSignature,
    stakingInitialized: !!deployment.initialization.staking?.txSignature,
    treasuryFunded: !!deployment.initialization.treasury?.funded,
    whitelistedTokensCount: deployment.tokens.whitelisted.length
  };
}

/**
 * Create initial deployment record
 */
export function createInitialDeployment(config: {
  network: string;
  programId: string;
  deploySignature?: string;
  idlAccount?: string;
  deployerAddress?: string;
}): DeploymentConfig {
  return {
    programId: config.programId,
    network: config.network,
    deployedAt: new Date().toISOString(),
    deploySignature: config.deploySignature,
    idlAccount: config.idlAccount,
    cluster: config.network === 'mainnet' ? 'mainnet-beta' : config.network,
    pdas: {},
    initialization: {},
    tokens: { whitelisted: [] },
    metadata: {
      deployerAddress: config.deployerAddress,
      anchorVersion: process.env.ANCHOR_VERSION,
      solanaCliVersion: process.env.SOLANA_CLI_VERSION,
      rustcVersion: process.env.RUSTC_VERSION,
    }
  };
}