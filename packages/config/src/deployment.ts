// @ts-ignore: Import JSON files directly
import devnetConfig from '../../../deployments/devnet-latest.json';
// @ts-ignore: Import JSON files directly  
import mainnetConfig from '../../../deployments/mainnet.json';

export type Network = 'devnet' | 'mainnet' | 'mainnet-beta';

export interface DeploymentConfig {
  network: string;
  programId: string;
  deployedAt: string;
  previousProgramId?: string;
  fundAmount?: number;
  cluster?: string;
  pdas?: {
    protocolState: string;
    treasury: string;
    feeReceiver: string;
    stakingPool: string;
    stakingVault: string;
    rewardVault: string;
  };
  staking?: {
    stakingTokenMint?: string;
    stakingPool?: string;
    stakingVault?: string;
    rewardVault?: string;
    stakingVaultAuthority?: string;
    updatedAt?: string;
  };
  initialization?: {
    protocol?: any;
    feeReceiver?: any;
    staking?: any;
    treasury?: any;
  };
  tokens?: {
    whitelisted: any[];
  };
  metadata?: any;
  feeReceiver?: {
    address?: string;
    initializedAt?: string;
  };
}

export function getDeploymentConfig(network: Network): DeploymentConfig {
  switch (network) {
    case 'mainnet':
    case 'mainnet-beta':
      return mainnetConfig as DeploymentConfig;
    case 'devnet':
    default:
      return devnetConfig as DeploymentConfig;
  }
}

export function getStakingConfig(network: Network) {
  const config = getDeploymentConfig(network);
  return config.staking;
}

export function getStakingTokenMint(network: Network): string | null {
  return getStakingConfig(network)?.stakingTokenMint || null;
}

export function getStakingVault(network: Network): string | null {
  return getStakingConfig(network)?.stakingVault || null;
}

export function getStakingPool(network: Network): string | null {
  return getStakingConfig(network)?.stakingPool || null;
}

export function getRewardVault(network: Network): string | null {
  return getStakingConfig(network)?.rewardVault || null;
}

export function getStakingVaultAuthority(network: Network): string | null {
  return getStakingConfig(network)?.stakingVaultAuthority || null;
}

// Get program ID from deployment config (renamed to avoid conflict with constants.ts)
export function getProgramIdFromDeployment(network: Network): string {
  const config = getDeploymentConfig(network);
  return config.programId;
}