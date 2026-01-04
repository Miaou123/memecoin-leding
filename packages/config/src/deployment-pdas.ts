import { PublicKey } from '@solana/web3.js';

interface DeploymentPDAs {
  "Protocol State"?: string;
  "Treasury"?: string;
  "feeReceiver"?: string;
  "rewardVault"?: string;
  "stakingPool"?: string;
  "stakingVault"?: string;
  protocolState?: string;
  treasury?: string;
  [key: string]: string | undefined;
}

interface Deployment {
  programId: string;
  network: string;
  pdas: DeploymentPDAs;
}

// Hard-coded deployment data for current devnet deployment
// TODO: Replace with proper file loading once ESM issues are resolved
const CURRENT_DEPLOYMENT: Deployment = {
  programId: "CEBgDniCL6eAGjom3gFxT9CSJv7RzJvcXGWqyCkEFksk",
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

// Load deployment from file
function loadDeployment(network: string = 'devnet'): Deployment | null {
  // For now, return hard-coded deployment for devnet
  if (network === 'devnet') {
    console.debug('Using hard-coded deployment config for devnet');
    return CURRENT_DEPLOYMENT;
  }
  
  // Don't try to load files in browser
  if (typeof globalThis !== 'undefined' && (globalThis as any).window) {
    return null;
  }
  
  // For other networks, return null for now
  console.debug('No deployment config available for network:', network);
  return null;
}

// Get current network from environment
function getCurrentNetwork(): string {
  return process.env.SOLANA_NETWORK || process.env.VITE_SOLANA_NETWORK || 'devnet';
}

// Get deployment PDAs
export function getDeploymentPDAs(network?: string): DeploymentPDAs {
  const targetNetwork = network || getCurrentNetwork();
  const deployment = loadDeployment(targetNetwork);
  return deployment?.pdas || {};
}

// Get specific PDA by key
export function getDeploymentPDA(key: string, network?: string): PublicKey | null {
  const pdas = getDeploymentPDAs(network);
  const address = pdas[key] || pdas[key.toLowerCase()];
  
  if (!address) {
    console.warn(`PDA "${key}" not found in deployment file`);
    return null;
  }
  
  try {
    return new PublicKey(address);
  } catch (error) {
    console.error(`Invalid PDA address for "${key}": ${address}`);
    return null;
  }
}

// Specific PDA getters
export function getProtocolStatePDA(network?: string): PublicKey | null {
  return getDeploymentPDA('Protocol State', network) || getDeploymentPDA('protocolState', network);
}

export function getTreasuryPDA(network?: string): PublicKey | null {
  return getDeploymentPDA('Treasury', network) || getDeploymentPDA('treasury', network);
}

export function getFeeReceiverPDA(network?: string): PublicKey | null {
  return getDeploymentPDA('feeReceiver', network);
}

export function getRewardVaultPDA(network?: string): PublicKey | null {
  return getDeploymentPDA('rewardVault', network);
}

export function getStakingPoolPDA(network?: string): PublicKey | null {
  return getDeploymentPDA('stakingPool', network);
}

export function getStakingVaultPDA(network?: string): PublicKey | null {
  return getDeploymentPDA('stakingVault', network);
}

// Get program ID from deployment
export function getDeploymentProgramId(network?: string): string {
  const targetNetwork = network || getCurrentNetwork();
  const deployment = loadDeployment(targetNetwork);
  return deployment?.programId || '';
}

// For user-specific PDAs that still need derivation
export function deriveUserStakePDA(stakingPool: PublicKey, user: PublicKey, network?: string): [PublicKey, number] {
  const programId = getDeploymentProgramId(network);
  if (!programId) {
    throw new Error('Program ID not found in deployment');
  }
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    new PublicKey(programId)
  );
}

export function deriveLoanPDA(borrower: PublicKey, tokenMint: PublicKey, loanIndex: number, network?: string): [PublicKey, number] {
  const programId = getDeploymentProgramId(network);
  if (!programId) {
    throw new Error('Program ID not found in deployment');
  }
  
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('loan'),
      borrower.toBuffer(),
      tokenMint.toBuffer(),
      Buffer.from(loanIndex.toString())
    ],
    new PublicKey(programId)
  );
}

export function deriveTokenConfigPDA(tokenMint: PublicKey, network?: string): [PublicKey, number] {
  const programId = getDeploymentProgramId(network);
  if (!programId) {
    throw new Error('Program ID not found in deployment');
  }
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    new PublicKey(programId)
  );
}

export function deriveVaultPDA(loanPda: PublicKey, network?: string): [PublicKey, number] {
  const programId = getDeploymentProgramId(network);
  if (!programId) {
    throw new Error('Program ID not found in deployment');
  }
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), loanPda.toBuffer()],
    new PublicKey(programId)
  );
}