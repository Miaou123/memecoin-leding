import { Connection } from '@solana/web3.js';

/**
 * Creates a Solana Connection instance that uses our backend RPC proxy
 * This protects the API key from being exposed to the client
 */
export function createConnection(commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Connection {
  // Use backend proxy endpoint instead of direct RPC URL
  const proxyUrl = `${import.meta.env.VITE_API_URL}/api/rpc-proxy/rpc`;
  
  // Fallback to public endpoint if API URL is not configured
  const rpcUrl = import.meta.env.VITE_API_URL 
    ? proxyUrl 
    : 'https://api.mainnet-beta.solana.com';
  
  return new Connection(rpcUrl, {
    commitment,
    // Disable preflight checks since we're using a proxy
    disableRetryOnRateLimit: false,
  });
}

/**
 * Gets the RPC endpoint URL
 * In production, this returns our proxy endpoint
 */
export function getRpcEndpoint(): string {
  if (import.meta.env.VITE_API_URL) {
    return `${import.meta.env.VITE_API_URL}/api/rpc-proxy/rpc`;
  }
  
  // Fallback for local development without backend
  console.warn('VITE_API_URL not set, using public Solana RPC');
  return 'https://api.mainnet-beta.solana.com';
}