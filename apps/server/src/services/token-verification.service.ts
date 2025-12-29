import axios from 'axios';
import { TokenTier } from '@memecoin-lending/types';
import {
  TokenVerificationResult,
  TokenVerificationCache,
  DexScreenerResponse,
  DexScreenerPair,
  PumpFunTokenInfo,
} from '@memecoin-lending/types';
import { manualWhitelistService } from './manual-whitelist.service';

export class TokenVerificationService {
  private cache: TokenVerificationCache = {};
  private readonly cacheTimeout: number;
  private readonly minLiquidityUsd: number;
  private readonly dexScreenerTimeout: number;

  constructor() {
    this.cacheTimeout = parseInt(process.env.TOKEN_CACHE_TTL_MS || '300000'); // 5 minutes
    this.minLiquidityUsd = parseInt(process.env.MIN_LIQUIDITY_USD || '0'); // 0 for testing
    this.dexScreenerTimeout = parseInt(process.env.DEXSCREENER_API_TIMEOUT || '10000'); // 10 seconds
  }

  async verifyToken(mint: string): Promise<TokenVerificationResult> {
    try {
      // Validate mint address format
      if (!this.isValidMintAddress(mint)) {
        return this.createInvalidResult(mint, 'Invalid mint address format');
      }

      // Check cache first
      const cached = this.getCachedResult(mint);
      if (cached) {
        return cached;
      }

      // Check manual whitelist first (takes priority)
      const whitelistEntry = await manualWhitelistService.getWhitelistEntry(mint);
      if (whitelistEntry && whitelistEntry.enabled) {
        const result = this.createWhitelistResult(whitelistEntry);
        // Cache the result
        this.cacheResult(mint, result);
        return result;
      }

      // If not in whitelist or disabled, check PumpFun via DexScreener API
      const tokenData = await this.fetchTokenFromDexScreener(mint);
      const result = this.processTokenData(mint, tokenData);
      
      // Cache the result
      this.cacheResult(mint, result);
      
      return result;
    } catch (error) {
      console.error(`Error verifying token ${mint}:`, error);
      
      // Return cached data if available during error
      const cached = this.getCachedResult(mint, true); // Allow expired cache
      if (cached) {
        return cached;
      }
      
      return this.createInvalidResult(mint, 'Failed to verify token - API error');
    }
  }

  async getPumpFunTokens(minLiquidity = 0, limit = 50): Promise<TokenVerificationResult[]> {
    // Get manually whitelisted tokens (they are considered valid regardless of source)
    const whitelistEntries = await manualWhitelistService.getWhitelistEntries({
      filters: { enabled: true },
      limit: Math.min(limit, 50),
      sortBy: 'addedAt',
      sortOrder: 'desc',
    });

    // Convert whitelist entries to TokenVerificationResult
    const whitelistedTokens = whitelistEntries.entries.map(entry => this.createWhitelistResult(entry));

    // For now, we only return whitelisted tokens
    // In the future, this could be extended to fetch popular PumpFun tokens from an external API
    return whitelistedTokens;
  }

  private async fetchTokenFromDexScreener(mint: string): Promise<DexScreenerResponse | null> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
      const response = await axios.get<DexScreenerResponse>(url, {
        timeout: this.dexScreenerTimeout,
        headers: {
          'User-Agent': 'MemecoinLending/1.0',
        },
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('API request timeout');
        }
        if (error.response?.status === 404) {
          return null; // Token not found
        }
      }
      throw error;
    }
  }

  private processTokenData(mint: string, data: DexScreenerResponse | null): TokenVerificationResult {
    if (!data?.pairs || data.pairs.length === 0) {
      return this.createInvalidResult(mint, 'Token not found on any DEX');
    }

    // Find PumpFun pairs first, then other valid pairs
    const pumpFunPair = data.pairs.find(pair => this.isPumpFunPair(pair));
    const validPair = pumpFunPair || data.pairs.find(pair => pair.liquidity?.usd);

    if (!validPair) {
      return this.createInvalidResult(mint, 'No valid trading pairs found');
    }

    if (!pumpFunPair) {
      return this.createInvalidResult(mint, 'Token is not from PumpFun platform');
    }

    const liquidity = validPair.liquidity?.usd || 0;
    
    if (liquidity < this.minLiquidityUsd) {
      return this.createInvalidResult(
        mint, 
        `Insufficient liquidity: $${liquidity.toFixed(2)} (minimum: $${this.minLiquidityUsd})`
      );
    }

    const tier = this.determineTier(liquidity);
    const ltvBps = this.getLtvForTier(tier);

    return {
      isValid: true,
      mint,
      symbol: validPair.baseToken.symbol,
      name: validPair.baseToken.name,
      liquidity,
      dexId: validPair.dexId,
      pairAddress: validPair.pairAddress,
      tier,
      ltvBps,
      verifiedAt: Date.now(),
      isWhitelisted: false,
      whitelistSource: 'pumpfun',
    };
  }

  private isPumpFunPair(pair: DexScreenerPair): boolean {
    const pumpFunDexIds = ['pumpfun', 'pumpswap'];
    
    // Check if dexId matches PumpFun variants
    if (pumpFunDexIds.includes(pair.dexId.toLowerCase())) {
      return true;
    }
    
    // Check if pair address ends with 'pump' (some PumpFun variants)
    if (pair.pairAddress.toLowerCase().endsWith('pump')) {
      return true;
    }
    
    return false;
  }

  private determineTier(liquidity: number): TokenTier {
    if (liquidity >= 1000000) {
      return TokenTier.Gold; // >= $1M
    } else if (liquidity >= 500000) {
      return TokenTier.Silver; // >= $500K
    } else {
      return TokenTier.Bronze; // >= $0 (for testing)
    }
  }

  private getLtvForTier(tier: TokenTier): number {
    switch (tier) {
      case TokenTier.Gold:
        return 7000; // 70%
      case TokenTier.Silver:
        return 6000; // 60%
      case TokenTier.Bronze:
        return 5000; // 50%
      default:
        return 5000;
    }
  }

  private isValidMintAddress(mint: string): boolean {
    // Basic validation for Solana mint addresses
    // Should be base58 encoded and between 32-44 characters
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(mint);
  }

  private getCachedResult(mint: string, allowExpired = false): TokenVerificationResult | null {
    const cached = this.cache[mint];
    if (!cached) {
      return null;
    }

    const isExpired = Date.now() - cached.timestamp > this.cacheTimeout;
    if (isExpired && !allowExpired) {
      delete this.cache[mint];
      return null;
    }

    return cached.result;
  }

  private cacheResult(mint: string, result: TokenVerificationResult): void {
    this.cache[mint] = {
      result,
      timestamp: Date.now(),
    };
  }

  private createWhitelistResult(entry: any): TokenVerificationResult {
    return {
      isValid: true,
      mint: entry.mint,
      symbol: entry.symbol,
      name: entry.name,
      liquidity: 0, // Manual whitelist entries don't have liquidity data
      tier: entry.tier,
      ltvBps: entry.ltvBps,
      verifiedAt: Date.now(),
      isWhitelisted: true,
      whitelistSource: 'manual',
      whitelistReason: entry.reason || 'Manually whitelisted by admin',
    };
  }

  private createInvalidResult(mint: string, reason: string): TokenVerificationResult {
    return {
      isValid: false,
      mint,
      liquidity: 0,
      reason,
      verifiedAt: Date.now(),
      isWhitelisted: false,
    };
  }

  // Utility method to convert PumpFun data
  convertToPumpFunTokenInfo(result: TokenVerificationResult, pair: DexScreenerPair): PumpFunTokenInfo {
    return {
      mint: result.mint,
      symbol: result.symbol || '',
      name: result.name || '',
      liquidity: result.liquidity,
      volume24h: pair.volume?.h24 || 0,
      priceUsd: pair.priceUsd || '0',
      fdv: pair.fdv || 0,
      pairAddress: result.pairAddress || '',
      dexId: result.dexId || '',
    };
  }

  // Cleanup expired cache entries periodically
  private cleanupCache(): void {
    const now = Date.now();
    Object.keys(this.cache).forEach(mint => {
      if (now - this.cache[mint].timestamp > this.cacheTimeout) {
        delete this.cache[mint];
      }
    });
  }
}

export const tokenVerificationService = new TokenVerificationService();