#!/usr/bin/env tsx

import { Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import toml from 'toml';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Load .env from root directory
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

// Re-export types from deployment-store
export type { DeploymentConfig, TokenConfig, InitializationRecord } from './deployment-store.js';
import { loadDeployment } from './deployment-store.js';

/**
 * Get program ID for a specific network
 * Priority: 1. deployments/{network}-latest.json 2. Anchor.toml 3. Error
 */
export function getProgramId(network: string): string {
  // First check: deployment artifacts
  const deployment = loadDeployment(network);
  if (deployment?.programId) {
    return deployment.programId;
  }

  // Fallback: Anchor.toml
  const anchorTomlPath = path.join(ROOT_DIR, 'Anchor.toml');
  if (fs.existsSync(anchorTomlPath)) {
    try {
      const anchorConfig = toml.parse(fs.readFileSync(anchorTomlPath, 'utf8'));
      const programId = anchorConfig.programs?.[network]?.memecoin_lending;
      if (programId) {
        return programId;
      }
    } catch (error) {
      console.warn(`⚠️  Failed to parse Anchor.toml`);
    }
  }

  throw new Error(
    `❌ Program ID not found for network '${network}'\n` +
    `   Searched:\n` +
    `   - ${deploymentPath}\n` +
    `   - ${anchorTomlPath} [programs.${network}.memecoin_lending]\n` +
    `   \n` +
    `   💡 Run 'npm run deploy:full --network ${network}' first`
  );
}

/**
 * Get RPC URL for a specific network
 * Priority: 1. process.env.SOLANA_RPC_URL 2. Default URLs
 */
export function getRpcUrl(network: string): string {
  // First check: environment variable
  if (process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL;
  }

  // Fallback: default URLs
  const defaultUrls: Record<string, string> = {
    mainnet: 'https://api.mainnet-beta.solana.com',
    devnet: 'https://api.devnet.solana.com',
    localnet: 'http://127.0.0.1:8899',
    localhost: 'http://127.0.0.1:8899',
  };

  const url = defaultUrls[network];
  if (!url) {
    throw new Error(
      `❌ RPC URL not found for network '${network}'\n` +
      `   Set SOLANA_RPC_URL in .env or use: ${Object.keys(defaultUrls).join(', ')}`
    );
  }

  return url;
}

/**
 * Load admin keypair from file
 * Default path: ./keys/admin.json (relative to scripts directory)
 */
export function getAdminKeypair(keypairPath?: string): Keypair {
  const defaultPath = path.join(__dirname, 'keys', 'admin.json');
  const resolvedPath = keypairPath ? path.resolve(keypairPath) : defaultPath;

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `❌ Admin keypair not found: ${resolvedPath}\n` +
      `   Create it with: solana-keygen new --outfile ${resolvedPath}`
    );
  }

  try {
    const keyData = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(keyData));
  } catch (error) {
    throw new Error(`❌ Invalid keypair file: ${resolvedPath}\n${error}`);
  }
}

// Re-export deployment functions from deployment-store
export { 
  saveDeployment as saveDeploymentConfig,
  updateDeployment,
  getAddress,
  getProtocolAddresses,
  isInitialized,
  getInitializationInfo,
  addWhitelistedToken,
  getWhitelistedTokens,
  isTokenWhitelisted,
  getDeploymentStatus,
  createInitialDeployment
} from './deployment-store.js';

/**
 * Get network configuration object
 */
export function getNetworkConfig(network: string) {
  return {
    network,
    programId: getProgramId(network),
    rpcUrl: getRpcUrl(network),
    cluster: network === 'mainnet' ? 'mainnet-beta' : network,
  };
}

/**
 * Validate network parameter
 */
export function validateNetwork(network: string): void {
  const validNetworks = ['mainnet', 'devnet', 'localnet', 'localhost'];
  if (!validNetworks.includes(network)) {
    throw new Error(
      `❌ Invalid network: ${network}\n` +
      `   Valid options: ${validNetworks.join(', ')}`
    );
  }
}

/**
 * Parse command line arguments for network option
 */
export function parseNetworkArg(args: string[] = process.argv): string {
  const networkIndex = args.findIndex(arg => arg === '--network' || arg === '-n');
  if (networkIndex === -1 || networkIndex === args.length - 1) {
    throw new Error(
      `❌ Missing --network argument\n` +
      `   Usage: npx tsx script.ts --network <devnet|mainnet|localnet>`
    );
  }
  
  const network = args[networkIndex + 1];
  validateNetwork(network);
  return network;
}

/**
 * Get current program ID from lib.rs declare_id! macro
 */
export function getCurrentProgramId(): string {
  const libRsPath = path.join(ROOT_DIR, 'programs', 'memecoin-lending', 'src', 'lib.rs');
  
  if (!fs.existsSync(libRsPath)) {
    throw new Error(`❌ lib.rs not found: ${libRsPath}`);
  }

  const content = fs.readFileSync(libRsPath, 'utf8');
  const match = content.match(/declare_id!\("([^"]+)"\)/);
  
  if (!match) {
    throw new Error(`❌ declare_id! not found in ${libRsPath}`);
  }

  return match[1];
}