import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DeploymentConfig {
  programId: string;
  network: string;
  pdas: {
    protocolState?: string;
    treasury?: string;
    feeReceiver?: string;
    stakingPool?: string;
    rewardVault?: string;
  };
}

let cachedDeployment: DeploymentConfig | null = null;

export function loadDeployment(): DeploymentConfig {
  if (cachedDeployment) return cachedDeployment;
  
  const network = process.env.SOLANA_NETWORK || 'devnet';
  
  const possiblePaths = [
    path.join(process.cwd(), 'deployments', `${network}-latest.json`),
    path.join(process.cwd(), '..', 'deployments', `${network}-latest.json`),
    path.join(process.cwd(), '..', '..', 'deployments', `${network}-latest.json`),
    path.join(__dirname, '..', '..', '..', '..', 'deployments', `${network}-latest.json`),
    path.join(__dirname, '..', '..', '..', '..', '..', 'deployments', `${network}-latest.json`),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      cachedDeployment = JSON.parse(content);
      console.log(`✅ Loaded deployment from: ${p}`);
      console.log(`   Network: ${cachedDeployment!.network}`);
      console.log(`   Program: ${cachedDeployment!.programId}`);
      if (cachedDeployment!.pdas.treasury) {
        console.log(`   Treasury: ${cachedDeployment!.pdas.treasury}`);
      }
      if (cachedDeployment!.pdas.protocolState) {
        console.log(`   Protocol State: ${cachedDeployment!.pdas.protocolState}`);
      }
      return cachedDeployment!;
    }
  }
  
  // Fallback: try to use environment variables if no deployment file
  console.warn(`⚠️  No deployment file found for network: ${network}`);
  console.log('   Falling back to environment variables...');
  
  // Create a minimal deployment config from env vars
  cachedDeployment = {
    programId: process.env.PROGRAM_ID || '',
    network,
    pdas: {
      treasury: process.env.TREASURY_PDA,
      protocolState: process.env.PROTOCOL_STATE_PDA,
    }
  };
  
  if (!cachedDeployment.programId) {
    throw new Error(`No deployment file found and PROGRAM_ID not set for network: ${network}`);
  }
  
  return cachedDeployment;
}

export function getProgramId(): PublicKey {
  const deployment = loadDeployment();
  if (!deployment.programId) {
    throw new Error('Program ID not found in deployment config');
  }
  return new PublicKey(deployment.programId);
}

export function getTreasuryPda(): PublicKey | null {
  const pda = loadDeployment().pdas.treasury;
  return pda ? new PublicKey(pda) : null;
}

export function getProtocolStatePda(): PublicKey | null {
  const pda = loadDeployment().pdas.protocolState;
  return pda ? new PublicKey(pda) : null;
}

export function getStakingPoolPda(): PublicKey | null {
  const pda = loadDeployment().pdas.stakingPool;
  return pda ? new PublicKey(pda) : null;
}

export function getRewardVaultPda(): PublicKey | null {
  const pda = loadDeployment().pdas.rewardVault;
  return pda ? new PublicKey(pda) : null;
}

export function getFeeReceiverPda(): PublicKey | null {
  const pda = loadDeployment().pdas.feeReceiver;
  return pda ? new PublicKey(pda) : null;
}