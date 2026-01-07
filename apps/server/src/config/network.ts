import { loadDeployment } from './deployment.js';

export type NetworkType = 'devnet' | 'mainnet-beta';

interface NetworkConfig {
  network: NetworkType;
  rpcUrl: string;
  programId: string;
  treasuryPda?: string;
  protocolStatePda?: string;
  feeReceiverPda?: string;
  rewardVaultPda?: string;
  explorerUrl: string;
}

export function getNetworkConfig(): NetworkConfig {
  const network = (process.env.SOLANA_NETWORK || 'devnet') as NetworkType;
  const deployment = loadDeployment();

  return {
    network,
    rpcUrl: process.env.SOLANA_RPC_URL || (network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com'),
    programId: deployment.programId,
    treasuryPda: deployment.pdas?.treasury,
    protocolStatePda: deployment.pdas?.protocolState,
    feeReceiverPda: deployment.pdas?.feeReceiver,
    rewardVaultPda: deployment.pdas?.rewardVault,
    explorerUrl: 'https://explorer.solana.com',
  };
}

export function isMainnet(): boolean {
  return (process.env.SOLANA_NETWORK || 'devnet') === 'mainnet-beta';
}

export function getExplorerUrl(txSignature: string): string {
  const config = getNetworkConfig();
  const clusterParam = config.network === 'mainnet-beta' ? '' : `?cluster=${config.network}`;
  return `${config.explorerUrl}/tx/${txSignature}${clusterParam}`;
}

export function validateMainnetConfig(): void {
  if (!isMainnet()) return;

  const config = getNetworkConfig();

  if (!config.programId || !config.treasuryPda || !config.protocolStatePda) {
    throw new Error('Incomplete deployment. Check deployments/mainnet-latest.json');
  }

  const requiredEnv = ['ADMIN_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  const missing = requiredEnv.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  console.log('✅ Mainnet configuration validated');
}