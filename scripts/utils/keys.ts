import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Single source of truth - relative to project root
// From scripts/utils/, go up 2 levels to reach project root
const ADMIN_KEYPAIR_PATH = path.resolve(__dirname, '../../keys/admin.json');

let adminKeypair: Keypair | null = null;

/**
 * Load admin keypair from /keys/admin.json
 * This keypair is used for all admin operations in scripts
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