import { HttpsProxyAgent } from 'https-proxy-agent';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

const JUPITER_PRICE_API_V2 = 'https://api.jup.ag/price/v2';
const JUPITER_PRICE_API_V3 = 'https://api.jup.ag/price/v3';

interface ApiEndpoint {
  id: number;
  apiKey: string;
  proxy: string | null;
  agent: HttpsProxyAgent<string> | null;
  
  // Health tracking
  consecutiveFailures: number;
  lastFailure: number | null;
  last429: number | null;
  totalRequests: number;
  totalFailures: number;
  avgLatency: number;
  isHealthy: boolean;
  cooldownUntil: number | null;
}

export interface JupiterPriceData {
  price: number;
  extraInfo?: {
    lastSwappedPrice?: {
      lastJupiterSellAt: number;
      lastJupiterSellPrice: string;
      lastJupiterBuyAt: number;
      lastJupiterBuyPrice: string;
    };
    quotedPrice?: {
      buyPrice: string;
      buyAt: number;
      sellPrice: string;
      sellAt: number;
    };
  };
}

interface JupiterPriceResponseV2 {
  data: Record<string, {
    id: string;
    price: string;
    extraInfo?: any;
  }>;
  timeTaken: number;
}

interface JupiterPriceResponseV3 {
  [mint: string]: {
    id: string;
    type: string;
    price: string;
    usdPrice?: number;
    priceChange24h?: number;
    decimals?: number;
  };
}

export class JupiterApiClient {
  private endpoints: ApiEndpoint[] = [];
  private currentIndex = 0;
  private apiVersion: 'v2' | 'v3' = 'v3';
  
  // Config
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly COOLDOWN_MS = 60_000; // 1 min cooldown after repeated failures
  private readonly RATE_LIMIT_COOLDOWN_MS = 30_000; // 30s after 429
  private readonly REQUEST_TIMEOUT_MS = 8_000;
  
  constructor(version: 'v2' | 'v3' = 'v3') {
    this.apiVersion = version;
    this.loadEndpoints();
  }

  private loadEndpoints(): void {
    // Load numbered keys (1-10)
    for (let i = 1; i <= 10; i++) {
      const apiKey = process.env[`JUPITER_API_KEY${i}`];
      const proxy = process.env[`JUPITER_PROXY${i}`];
      
      if (apiKey) {
        this.endpoints.push(this.createEndpoint(i, apiKey, proxy || null));
      }
    }
    
    // Fallback to legacy single key if no numbered keys found
    if (this.endpoints.length === 0) {
      const legacyKey = process.env.JUPITER_API_KEY;
      if (legacyKey) {
        this.endpoints.push(this.createEndpoint(0, legacyKey, null));
        console.log('⚠️ Using legacy single JUPITER_API_KEY - consider migrating to multi-key setup');
      }
    }
    
    if (this.endpoints.length === 0) {
      throw new Error('❌ No Jupiter API keys configured! Set JUPITER_API_KEY1 or JUPITER_API_KEY in .env');
    }
    
    const withProxy = this.endpoints.filter(e => e.proxy).length;
    console.log(`🔑 Jupiter client initialized: ${this.endpoints.length} keys (${withProxy} with proxies)`);
  }

  private createEndpoint(id: number, apiKey: string, proxy: string | null): ApiEndpoint {
    let agent: HttpsProxyAgent<string> | null = null;
    
    if (proxy) {
      try {
        agent = new HttpsProxyAgent(proxy);
        console.log(`   Key ${id}: via proxy`);
      } catch (error) {
        console.error(`❌ Invalid proxy config for key ${id}:`, error);
      }
    } else {
      console.log(`   Key ${id}: direct (no proxy)`);
    }
    
    return {
      id,
      apiKey,
      proxy,
      agent,
      consecutiveFailures: 0,
      lastFailure: null,
      last429: null,
      totalRequests: 0,
      totalFailures: 0,
      avgLatency: 0,
      isHealthy: true,
      cooldownUntil: null,
    };
  }

  /**
   * Get the next healthy endpoint using round-robin with health checks
   */
  private getNextEndpoint(): ApiEndpoint | null {
    if (this.endpoints.length === 0) return null;
    
    const now = Date.now();
    const startIndex = this.currentIndex;
    
    // Try to find a healthy endpoint
    do {
      const endpoint = this.endpoints[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
      
      // Check if cooldown expired - restore health
      if (endpoint.cooldownUntil && now > endpoint.cooldownUntil) {
        endpoint.cooldownUntil = null;
        endpoint.isHealthy = true;
        endpoint.consecutiveFailures = 0;
        console.log(`🟢 Jupiter key ${endpoint.id} recovered from cooldown`);
      }
      
      if (endpoint.isHealthy) {
        return endpoint;
      }
    } while (this.currentIndex !== startIndex);
    
    // All endpoints unhealthy - return the one with earliest cooldown expiry
    const sortedByRecovery = [...this.endpoints].sort((a, b) => 
      (a.cooldownUntil || 0) - (b.cooldownUntil || 0)
    );
    
    console.warn('⚠️ All Jupiter endpoints unhealthy, using least-bad option');
    return sortedByRecovery[0];
  }

  /**
   * Mark endpoint as failed
   */
  private async markFailure(endpoint: ApiEndpoint, statusCode?: number): Promise<void> {
    const now = Date.now();
    endpoint.consecutiveFailures++;
    endpoint.totalFailures++;
    endpoint.lastFailure = now;
    
    const is429 = statusCode === 429;
    const is401or403 = statusCode === 401 || statusCode === 403;
    
    if (is429) {
      endpoint.last429 = now;
      endpoint.cooldownUntil = now + this.RATE_LIMIT_COOLDOWN_MS;
      endpoint.isHealthy = false;
      console.warn(`🚫 Jupiter key ${endpoint.id} rate limited (429), cooldown 30s`);
      
      // Log rate limiting event
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.PRICE_API_RATE_LIMITED,
        message: `Jupiter endpoint ${endpoint.id} rate limited`,
        details: {
          endpointId: endpoint.id,
          hasProxy: !!endpoint.proxy,
          consecutiveFailures: endpoint.consecutiveFailures,
        },
        source: 'jupiter-client',
      });
    } else if (is401or403) {
      // Auth error - longer cooldown, likely bad key
      endpoint.cooldownUntil = now + this.COOLDOWN_MS * 5;
      endpoint.isHealthy = false;
      console.error(`🔴 Jupiter key ${endpoint.id} auth failed (${statusCode}), cooldown 5min - check API key`);
      
      // Log auth failure
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'Price Monitoring',
        eventType: SECURITY_EVENT_TYPES.JUPITER_API_ERROR,
        message: `Jupiter endpoint ${endpoint.id} authentication failed`,
        details: {
          endpointId: endpoint.id,
          statusCode,
          hasProxy: !!endpoint.proxy,
        },
        source: 'jupiter-client',
      });
    } else if (endpoint.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      endpoint.cooldownUntil = now + this.COOLDOWN_MS;
      endpoint.isHealthy = false;
      console.warn(`🔴 Jupiter key ${endpoint.id} marked unhealthy after ${endpoint.consecutiveFailures} failures`);
    }
  }

  /**
   * Mark endpoint as successful
   */
  private markSuccess(endpoint: ApiEndpoint, latencyMs: number): void {
    endpoint.consecutiveFailures = 0;
    endpoint.totalRequests++;
    endpoint.isHealthy = true;
    endpoint.cooldownUntil = null;
    
    // Rolling average latency (90% old, 10% new)
    endpoint.avgLatency = endpoint.avgLatency === 0 
      ? latencyMs 
      : endpoint.avgLatency * 0.9 + latencyMs * 0.1;
  }

  /**
   * Fetch prices with automatic rotation and fallback
   */
  async fetchPrices(mints: string[]): Promise<Record<string, JupiterPriceData>> {
    if (mints.length === 0) return {};
    
    let lastError: Error | null = null;
    const triedEndpoints = new Set<number>();
    
    // Try up to all endpoints
    while (triedEndpoints.size < this.endpoints.length) {
      const endpoint = this.getNextEndpoint();
      if (!endpoint || triedEndpoints.has(endpoint.id)) {
        break;
      }
      triedEndpoints.add(endpoint.id);
      
      try {
        const result = await this.fetchWithEndpoint(endpoint, mints);
        return result;
      } catch (error: any) {
        lastError = error;
        
        // Extract status code if available
        const statusMatch = error.message?.match(/(\d{3})/);
        const statusCode = statusMatch ? parseInt(statusMatch[1]) : undefined;
        
        await this.markFailure(endpoint, statusCode);
        
        // Small delay before trying next endpoint
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    throw lastError || new Error('All Jupiter endpoints failed');
  }

  /**
   * Fetch from specific endpoint
   */
  private async fetchWithEndpoint(
    endpoint: ApiEndpoint, 
    mints: string[]
  ): Promise<Record<string, JupiterPriceData>> {
    const baseUrl = this.apiVersion === 'v3' ? JUPITER_PRICE_API_V3 : JUPITER_PRICE_API_V2;
    const url = `${baseUrl}?ids=${mints.join(',')}`;
    const startTime = Date.now();
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    
    // Only add API key header if we have one
    if (endpoint.apiKey) {
      headers['x-api-key'] = endpoint.apiKey;
    }
    
    const fetchOptions: RequestInit & { agent?: any } = {
      headers,
      signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
    };
    
    // Add proxy agent if configured
    if (endpoint.agent) {
      fetchOptions.agent = endpoint.agent;
    }
    
    const response = await fetch(url, fetchOptions);
    const latency = Date.now() - startTime;
    
    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    this.markSuccess(endpoint, latency);
    
    // Transform response based on API version
    return this.apiVersion === 'v3' 
      ? this.transformV3Response(data as JupiterPriceResponseV3)
      : this.transformV2Response(data as JupiterPriceResponseV2);
  }

  private transformV2Response(data: JupiterPriceResponseV2): Record<string, JupiterPriceData> {
    const result: Record<string, JupiterPriceData> = {};
    
    for (const [mint, info] of Object.entries(data.data || {})) {
      result[mint] = {
        price: parseFloat(info.price),
        extraInfo: info.extraInfo,
      };
    }
    
    return result;
  }

  private transformV3Response(data: JupiterPriceResponseV3): Record<string, JupiterPriceData> {
    const result: Record<string, JupiterPriceData> = {};
    
    for (const [mint, info] of Object.entries(data)) {
      if (info && (info.price || info.usdPrice)) {
        result[mint] = {
          price: info.usdPrice || parseFloat(info.price),
        };
      }
    }
    
    return result;
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus(): {
    total: number;
    healthy: number;
    apiVersion: string;
    endpoints: Array<{
      id: number;
      healthy: boolean;
      consecutiveFailures: number;
      totalRequests: number;
      totalFailures: number;
      avgLatencyMs: number;
      hasProxy: boolean;
      cooldownRemainingMs: number | null;
      successRate: string;
    }>;
  } {
    const now = Date.now();
    return {
      total: this.endpoints.length,
      healthy: this.endpoints.filter(e => e.isHealthy).length,
      apiVersion: this.apiVersion,
      endpoints: this.endpoints.map(e => {
        const total = e.totalRequests + e.totalFailures;
        const successRate = total > 0 
          ? ((e.totalRequests / total) * 100).toFixed(1) + '%'
          : 'N/A';
          
        return {
          id: e.id,
          healthy: e.isHealthy,
          consecutiveFailures: e.consecutiveFailures,
          totalRequests: e.totalRequests,
          totalFailures: e.totalFailures,
          avgLatencyMs: Math.round(e.avgLatency),
          hasProxy: !!e.proxy,
          cooldownRemainingMs: e.cooldownUntil ? Math.max(0, e.cooldownUntil - now) : null,
          successRate,
        };
      }),
    };
  }

  /**
   * Force reset all endpoints to healthy (for manual recovery)
   */
  resetAllEndpoints(): void {
    for (const endpoint of this.endpoints) {
      endpoint.isHealthy = true;
      endpoint.consecutiveFailures = 0;
      endpoint.cooldownUntil = null;
    }
    console.log('🔄 All Jupiter endpoints reset to healthy');
  }

  /**
   * Test a specific endpoint
   */
  async testEndpoint(id: number): Promise<{ 
    success: boolean; 
    latencyMs?: number; 
    error?: string 
  }> {
    const endpoint = this.endpoints.find(e => e.id === id);
    if (!endpoint) {
      return { success: false, error: 'Endpoint not found' };
    }
    
    const testMint = 'So11111111111111111111111111111111111111112'; // SOL
    const startTime = Date.now();
    
    try {
      await this.fetchWithEndpoint(endpoint, [testMint]);
      return { success: true, latencyMs: Date.now() - startTime };
    } catch (error: any) {
      return { success: false, error: error.message, latencyMs: Date.now() - startTime };
    }
  }

  /**
   * Test connectivity (useful for health checks)
   */
  async testConnection(): Promise<{ working: boolean; latency: number; error?: string }> {
    const testMint = 'So11111111111111111111111111111111111111112'; // SOL
    const startTime = Date.now();
    
    try {
      await this.fetchPrices([testMint]);
      return { working: true, latency: Date.now() - startTime };
    } catch (error: any) {
      return { working: false, latency: Date.now() - startTime, error: error.message };
    }
  }
}

// Singleton instances for different API versions
export const jupiterClientV2 = new JupiterApiClient('v2');
export const jupiterClientV3 = new JupiterApiClient('v3');

// Default export (v3 for current usage)
export const jupiterClient = jupiterClientV3;