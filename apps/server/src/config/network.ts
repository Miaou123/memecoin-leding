export type NetworkType = 'devnet' | 'mainnet-beta';

interface NetworkConfig {
  network: NetworkType;
  rpcUrl: string;
  programId: string;
  treasuryPda?: string;
  protocolStatePda?: string;
  explorerUrl: string;
}

const DEVNET_CONFIG: NetworkConfig = {
  network: 'devnet',
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: process.env.PROGRAM_ID || 'DWPzC5B8wCYFJFw9khPiCwSvErNJTVaBxpUzrxbTCNJk',
  treasuryPda: process.env.TREASURY_PDA,
  protocolStatePda: process.env.PROTOCOL_STATE_PDA,
  explorerUrl: 'https://explorer.solana.com',
};

const MAINNET_CONFIG: NetworkConfig = {
  network: 'mainnet-beta',
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  programId: process.env.PROGRAM_ID || '', // MUST be set for mainnet
  treasuryPda: process.env.TREASURY_PDA,
  protocolStatePda: process.env.PROTOCOL_STATE_PDA,
  explorerUrl: 'https://explorer.solana.com',
};

export function getNetworkConfig(): NetworkConfig {
  const network = (process.env.SOLANA_NETWORK || 'devnet') as NetworkType;
  
  if (network === 'mainnet-beta') {
    if (!MAINNET_CONFIG.programId) {
      throw new Error('PROGRAM_ID must be set for mainnet');
    }
    return MAINNET_CONFIG;
  }
  
  return DEVNET_CONFIG;
}

export function isMainnet(): boolean {
  return getNetworkConfig().network === 'mainnet-beta';
}

export function getExplorerUrl(txSignature: string): string {
  const config = getNetworkConfig();
  const clusterParam = config.network === 'mainnet-beta' ? '' : `?cluster=${config.network}`;
  return `${config.explorerUrl}/tx/${txSignature}${clusterParam}`;
}

export function validateMainnetConfig(): void {
  if (!isMainnet()) return;
  
  const required = [
    'PROGRAM_ID',
    'TREASURY_PDA',
    'ADMIN_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required mainnet config: ${missing.join(', ')}`);
  }
  
  console.log('✅ Mainnet configuration validated');
}