import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Single source of truth - relative to project root
// From apps/server/src/config, go up 4 levels to reach project root
const ADMIN_KEYPAIR_PATH = path.resolve(__dirname, '../../../../keys/admin.json');
const LIQUIDATOR_KEYPAIR_PATH = path.resolve(__dirname, '../../../../keys/liquidator.json');

let adminKeypair: Keypair | null = null;
let liquidatorKeypair: Keypair | null = null;

/**
 * Load admin keypair from /keys/admin.json
 * This keypair is used for:
 * - Price authority (signing loan transactions)
 * - Admin operations
 * - Liquidator operations
 * - Fee claiming
 * - Token verification/whitelisting
 */
export function getAdminKeypair(): Keypair {
  if (adminKeypair) {
    return adminKeypair;
  }

  if (!fs.existsSync(ADMIN_KEYPAIR_PATH)) {
    throw new Error(
      `Admin keypair not found at: ${ADMIN_KEYPAIR_PATH}\n` +
      `Please ensure /keys/admin.json exists in the project root.`
    );
  }

  try {
    const keypairData = JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, 'utf8'));
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`[Keys] Admin keypair loaded: ${adminKeypair.publicKey.toString()}`);
    return adminKeypair;
  } catch (error: any) {
    throw new Error(`Failed to load admin keypair: ${error.message}`);
  }
}

/**
 * Get admin public key as string
 */
export function getAdminPublicKey(): string {
  return getAdminKeypair().publicKey.toString();
}

/**
 * Load liquidator keypair from /keys/liquidator.json with fallback to admin.json
 * This keypair is used for liquidation operations
 */
export function getLiquidatorKeypair(): Keypair {
  if (liquidatorKeypair) {
    return liquidatorKeypair;
  }

  // Try to load liquidator keypair first
  if (fs.existsSync(LIQUIDATOR_KEYPAIR_PATH)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(LIQUIDATOR_KEYPAIR_PATH, 'utf8'));
      liquidatorKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      console.log(`[Keys] Liquidator keypair loaded: ${liquidatorKeypair.publicKey.toString()}`);
      return liquidatorKeypair;
    } catch (error: any) {
      console.warn(`[Keys] Failed to load liquidator keypair, falling back to admin: ${error.message}`);
    }
  }

  // Fallback to admin keypair
  console.log(`[Keys] Using admin keypair as liquidator (no liquidator.json found)`);
  liquidatorKeypair = getAdminKeypair();
  return liquidatorKeypair;
}

/**
 * Get liquidator public key as string
 */
export function getLiquidatorPublicKey(): string {
  return getLiquidatorKeypair().publicKey.toString();
}

// Aliases - price authority still uses admin keypair
export const getPriceAuthorityKeypair = getAdminKeypair;
export const getPriceAuthorityPublicKey = getAdminPublicKey;