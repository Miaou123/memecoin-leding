import { Cluster } from '@solana/web3.js';

export type NetworkType = 'mainnet-beta' | 'devnet' | 'localnet';

export interface NetworkConfig {
  name: NetworkType;
  cluster: Cluster | 'localnet';
  rpcUrl: string;
  wsUrl: string;
  apiUrl: string;
  explorerUrl: string;
}

export const NETWORKS: Record<NetworkType, NetworkConfig> = {
  'mainnet-beta': {
    name: 'mainnet-beta',
    cluster: 'mainnet-beta',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    apiUrl: process.env.API_URL || 'https://api.memecoin-lending.com',
    explorerUrl: 'https://explorer.solana.com',
  },
  'devnet': {
    name: 'devnet',
    cluster: 'devnet',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=',
    wsUrl: 'wss://api.devnet.solana.com',
    apiUrl: 'https://api-devnet.memecoin-lending.com',
    explorerUrl: 'https://explorer.solana.com',
  },
  'localnet': {
    name: 'localnet',
    cluster: 'localnet',
    rpcUrl: 'http://localhost:8899',
    wsUrl: 'ws://localhost:8900',
    apiUrl: 'http://localhost:3001',
    explorerUrl: 'https://explorer.solana.com',
  },
};

export const getNetworkConfig = (network: NetworkType = 'mainnet-beta'): NetworkConfig => {
  return NETWORKS[network];
};

export const getCurrentNetwork = (): NetworkType => {
  const env = process.env.SOLANA_NETWORK as NetworkType;
  return env || 'mainnet-beta';
};