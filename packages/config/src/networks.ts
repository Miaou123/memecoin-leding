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
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    apiUrl: 'https://api.memecoin-lending.com',
    explorerUrl: 'https://explorer.solana.com',
  },
  'devnet': {
    name: 'devnet',
    cluster: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
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

export const getNetworkConfig = (network?: NetworkType): NetworkConfig => {
  const net = network || getCurrentNetwork();
  const config = { ...NETWORKS[net] };
  
  // Override RPC URL from env if set
  if (process.env.SOLANA_RPC_URL) {
    config.rpcUrl = process.env.SOLANA_RPC_URL;
  }
  
  // Override WebSocket URL from env if set
  if (process.env.SOLANA_WS_URL) {
    config.wsUrl = process.env.SOLANA_WS_URL;
  }
  
  // Override API URL from env if set
  if (process.env.API_URL) {
    config.apiUrl = process.env.API_URL;
  }
  
  return config;
};

export const getCurrentNetwork = (): NetworkType => {
  // Check both server and client env vars
  const env = (process.env.SOLANA_NETWORK || process.env.VITE_SOLANA_NETWORK) as NetworkType;
  // Default to devnet for safety - must be explicitly set to mainnet
  return env || 'devnet';
};