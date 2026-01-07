import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { TokenTier } from '@memecoin-lending/types';
import {
  TokenVerificationResult,
  TokenVerificationCache,
  PoolBalanceInfo,
  TokenRejectionCode,
  DexScreenerResponse,
} from '@memecoin-lending/types';
import { getNetworkConfig, PROGRAM_ID, NetworkType, PUMPFUN_PROGRAM_ID } from '@memecoin-lending/config';
import { manualWhitelistService } from './manual-whitelist.service';
import { prisma } from '../db/client.js';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import { getAdminKeypair } from '../config/keys.js';

// Token suffix patterns
const PUMPFUN_SUFFIX = 'pump';
const BONK_SUFFIX = 'bonk';

// Pool balance thresholds
const MAX_TOKEN_RATIO_PERCENT = 80;  // Max 80% of pool can be the token
const MIN_QUOTE_RATIO_PERCENT = 20;  // Min 20% must be SOL/USD1
const MIN_LIQUIDITY_USD = 1000;      // Minimum $1,000 liquidity

// Token age requirement
const MIN_TOKEN_AGE_HOURS = parseInt(process.env.MIN_TOKEN_AGE_HOURS || '24');  // Token must be at least 24 hours old

// Valid quote tokens
const VALID_QUOTE_TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  // TODO: Replace with actual USD1 mint on mainnet
  USD1: process.env.USD1_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Using USDC as placeholder
};

// Helper function to get PumpFun bonding curve PDA
function getPumpFunBondingCurve(mint: PublicKey): PublicKey {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID
  );
  return bondingCurve;
}

// NodeWallet wrapper for Keypair
class NodeWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ('version' in tx) {
      (tx as VersionedTransaction).sign([this.payer]);
    } else {
      (tx as Transaction).partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map(tx => {
      if ('version' in tx) {
        (tx as VersionedTransaction).sign([this.payer]);
      } else {
        (tx as Transaction).partialSign(this.payer);
      }
      return tx;
    });
  }
}

export class TokenVerificationService {
  private cache: TokenVerificationCache = {};
  private readonly cacheTimeout: number;
  private readonly minLiquidityUsd: number; // For future mainnet use
  private readonly autoWhitelistEnabled: boolean;
  private adminKeypair: Keypair | null = null;
  private program: Program | null = null;
  private connection: Connection | null = null;
  private whitelistingLocks = new Map<string, Promise<boolean>>();

  constructor() {
    this.cacheTimeout = parseInt(process.env.TOKEN_CACHE_TTL_MS || '300000'); // 5 minutes
    this.minLiquidityUsd = parseInt(process.env.MIN_LIQUIDITY_USD || '0'); // 0 for testing
    this.autoWhitelistEnabled = process.env.AUTO_WHITELIST_ENABLED === 'true';
    
    this.initializeAnchorProgram();
  }

  async verifyToken(mint: string): Promise<TokenVerificationResult> {
    try {
      console.log(`[TokenVerification] Verifying: ${mint.substring(0, 8)}...`);
      
      // 1. Validate mint address format
      if (!this.isValidMintAddress(mint)) {
        return this.createInvalidResult(mint, 'Invalid mint address format', 'INVALID_ADDRESS');
      }

      // 2. Check cache first
      const cached = this.getCachedResult(mint);
      if (cached) {
        console.log(`[TokenVerification] Cache hit: ${mint.substring(0, 8)}...`);
        return cached;
      }

      // 3. Check manual whitelist (for non-pump tokens added by admin)
      const whitelistEntry = await manualWhitelistService.getWhitelistEntry(mint);
      if (whitelistEntry?.enabled) {
        const result = this.createWhitelistResult(whitelistEntry);
        this.cacheResult(mint, result);
        console.log(`[TokenVerification] Manual whitelist: ${whitelistEntry.symbol || mint.substring(0, 8)}...`);
        return result;
      }

      // 4. UPDATED: Check token suffix (pump OR bonk)
      const mintLower = mint.toLowerCase();
      const isPumpFun = mintLower.endsWith(PUMPFUN_SUFFIX);
      const isBonk = mintLower.endsWith(BONK_SUFFIX);

      if (!isPumpFun && !isBonk) {
        const result = this.createInvalidResult(
          mint, 
          'Token must be from PumpFun (address ends in "pump") or Bonk/Raydium (address ends in "bonk")',
          'NOT_SUPPORTED_DEX'
        );
        this.cacheResult(mint, result);
        return result;
      }

      const dexType = isPumpFun ? 'pumpfun' : 'raydium';
      console.log(`[TokenVerification] Detected ${dexType} token: ${mint.substring(0, 8)}...`);
      
      // Reject pure PumpFun (bonding curve) tokens - they must migrate first
      if (dexType === 'pumpfun') {
        const result = this.createInvalidResult(
          mint,
          'PumpFun tokens must migrate to Raydium or PumpSwap before lending is enabled. Only migrated tokens (pumpswap, raydium) are supported.',
          'NOT_SUPPORTED_DEX'
        );
        this.cacheResult(mint, result);
        return result;
      }

      // 5. NEW: Validate pool balance ratio
      const poolValidation = await this.validatePoolBalance(mint, dexType);
      
      if (!poolValidation.isValid) {
        const result: TokenVerificationResult = {
          isValid: false,
          mint,
          reason: poolValidation.reason,
          rejectionCode: poolValidation.rejectionCode || 'POOL_IMBALANCED',
          poolBalance: poolValidation.poolBalance,
          dexId: dexType,
          liquidity: poolValidation.liquidity || 0,
          verifiedAt: Date.now(),
        };
        this.cacheResult(mint, result);
        console.log(`[TokenVerification] Pool validation failed: ${poolValidation.reason}`);
        return result;
      }

      console.log(`[TokenVerification] Pool validated: ${poolValidation.poolBalance?.baseTokenPercent.toFixed(1)}% token / ${poolValidation.poolBalance?.quoteTokenPercent.toFixed(1)}% ${poolValidation.poolBalance?.quoteToken}`);

      // 6. Check if already on-chain
      const isOnChain = await this.isTokenOnChain(mint);
      
      if (!isOnChain && this.autoWhitelistEnabled && this.adminKeypair) {
        console.log(`[TokenVerification] Not on-chain, auto-whitelisting...`);
        try {
          await this.autoWhitelistWithLock(mint, {
            isValid: true,
            mint,
            tier: TokenTier.Bronze,
            ltvBps: 5000,
            dexId: dexType,
            liquidity: poolValidation.liquidity || 0,
            verifiedAt: Date.now(),
            isWhitelisted: false,
            poolBalance: poolValidation.poolBalance,
          });
          console.log(`[TokenVerification] Auto-whitelisted ${mint.substring(0, 8)}...`);
        } catch (error: any) {
          if (!error.message?.includes('already in use')) {
            console.error(`[TokenVerification] Auto-whitelist failed:`, error.message);
            return this.createInvalidResult(
              mint, 
              'Failed to whitelist token on-chain. Please try again.',
              'WHITELIST_FAILED'
            );
          } else {
            // Token was already whitelisted by another request, sync to database
            try {
              const mintPubkey = new PublicKey(mint);
              const bondingCurve = getPumpFunBondingCurve(mintPubkey);
              
              await prisma.token.upsert({
                where: { id: mint },
                update: { enabled: true },
                create: {
                  id: mint,
                  symbol: 'PUMP',
                  name: 'PumpFun Token',
                  decimals: 6,
                  tier: 'bronze',
                  poolAddress: bondingCurve.toString(), // Store bonding curve PDA
                  enabled: true,
                },
              });
              console.log(`[TokenVerification] Token synced to database after concurrent whitelist: ${mint.substring(0, 8)}...`);
            } catch (dbError: any) {
              console.warn(`[TokenVerification] Failed to sync concurrent token to database: ${dbError.message}`);
            }
          }
        }
      } else if (!isOnChain && !this.adminKeypair) {
        console.log(`[TokenVerification] Auto-whitelist disabled: no admin keypair`);
      } else if (isOnChain) {
        console.log(`[TokenVerification] Token already on-chain`);
        // Add database upsert to ensure it exists in DB too
        try {
          const mintPubkey = new PublicKey(mint);
          const bondingCurve = getPumpFunBondingCurve(mintPubkey);
          
          await prisma.token.upsert({
            where: { id: mint },
            update: { enabled: true },
            create: {
              id: mint,
              symbol: 'PUMP',
              name: 'PumpFun Token',
              decimals: 6,
              tier: 'bronze',
              poolAddress: bondingCurve.toString(), // Store bonding curve PDA
              enabled: true,
            },
          });
          console.log(`[TokenVerification] Token synced to database: ${mint.substring(0, 8)}...`);
        } catch (dbError: any) {
          console.warn(`[TokenVerification] Failed to sync token to database: ${dbError.message}`);
          // Don't throw - token is already on-chain, that's what matters
        }
      }

      // 7. Determine tier based on liquidity
      const tier = this.determineTier(poolValidation.liquidity || 0);

      // Return success
      const result: TokenVerificationResult = {
        isValid: true,
        mint,
        symbol: poolValidation.symbol,
        name: poolValidation.name,
        tier,
        ltvBps: this.getLtvForTier(tier),
        liquidity: poolValidation.liquidity || 0,
        dexId: dexType,
        pairAddress: poolValidation.pairAddress,
        verifiedAt: Date.now(),
        isWhitelisted: true,
        whitelistSource: 'auto',
        poolBalance: poolValidation.poolBalance,
      };
      
      this.cacheResult(mint, result);
      console.log(`[TokenVerification] Verification complete: valid=true, source=${result.whitelistSource}`);
      return result;
      
    } catch (error) {
      console.error(`[TokenVerification] Error verifying token ${mint}:`, error);
      
      // Return cached data if available during error
      const cached = this.getCachedResult(mint, true);
      if (cached) {
        return cached;
      }
      
      return this.createInvalidResult(mint, 'Failed to verify token');
    }
  }

  async getPumpFunTokens(minLiquidity = 0, limit = 50): Promise<TokenVerificationResult[]> {
    // Get manually whitelisted tokens
    const whitelistEntries = await manualWhitelistService.getWhitelistEntries({
      filters: { enabled: true },
      limit: Math.min(limit, 50),
      sortBy: 'addedAt',
      sortOrder: 'desc',
    });

    return whitelistEntries.entries.map(entry => this.createWhitelistResult(entry));
  }

  private isValidMintAddress(mint: string): boolean {
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
      liquidity: 0,
      tier: entry.tier,
      ltvBps: entry.ltvBps,
      verifiedAt: Date.now(),
      isWhitelisted: true,
      whitelistSource: 'manual',
      whitelistReason: entry.reason || 'Manually whitelisted by admin',
    };
  }

  /**
   * Update createInvalidResult to support rejection codes
   */
  private createInvalidResult(
    mint: string, 
    reason: string,
    rejectionCode?: TokenRejectionCode
  ): TokenVerificationResult {
    return {
      isValid: false,
      mint,
      liquidity: 0,
      reason,
      rejectionCode,
      verifiedAt: Date.now(),
      isWhitelisted: false,
    };
  }

  private async initializeAnchorProgram(): Promise<void> {
    try {
      if (!this.autoWhitelistEnabled) {
        console.log('[TokenVerification] Auto-whitelist disabled');
        return;
      }

      try {
        this.adminKeypair = getAdminKeypair();
      } catch (error: any) {
        console.warn(`[TokenVerification] Failed to load admin keypair: ${error.message}, auto-whitelist disabled`);
        return;
      }

      const network = (process.env.SOLANA_NETWORK as NetworkType) || 'devnet';
      const networkConfig = getNetworkConfig(network);
      this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');

      const possibleIdlPaths = [
        path.resolve('../../target/idl/memecoin_lending.json'),
        path.resolve('./target/idl/memecoin_lending.json'),
        path.resolve('../target/idl/memecoin_lending.json'),
        path.resolve('target/idl/memecoin_lending.json'),
      ];
      
      let idlPath = null;
      for (const testPath of possibleIdlPaths) {
        if (fs.existsSync(testPath)) {
          idlPath = testPath;
          break;
        }
      }
      
      if (!idlPath) {
        console.warn(`[TokenVerification] IDL not found, auto-whitelist disabled`);
        this.adminKeypair = null;
        return;
      }

      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

      const wallet = new NodeWallet(this.adminKeypair);
      const provider = new AnchorProvider(this.connection, wallet, {
        commitment: 'confirmed',
      });
      this.program = new Program(idl, provider);

      console.log(`[TokenVerification] Auto-whitelist initialized with admin: ${this.adminKeypair.publicKey.toString().substring(0, 8)}...`);
      
    } catch (error) {
      console.error('[TokenVerification] Failed to initialize Anchor program:', error);
      this.adminKeypair = null;
      this.program = null;
    }
  }

  private async isTokenOnChain(mint: string): Promise<boolean> {
    if (!this.program) {
      return false;
    }

    try {
      const programId = new PublicKey(PROGRAM_ID);
      const mintPubkey = new PublicKey(mint);
      
      const [tokenConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_config'), mintPubkey.toBuffer()],
        programId
      );

      await (this.program.account as any).tokenConfig.fetch(tokenConfigPDA);
      return true;
    } catch {
      return false;
    }
  }

  private async autoWhitelistWithLock(mint: string, tokenData: TokenVerificationResult): Promise<boolean> {
    const existingLock = this.whitelistingLocks.get(mint);
    if (existingLock) {
      return existingLock;
    }

    const whitelistPromise = this.autoWhitelistOnChain(mint, tokenData)
      .finally(() => {
        this.whitelistingLocks.delete(mint);
      });

    this.whitelistingLocks.set(mint, whitelistPromise);
    return whitelistPromise;
  }

  private async autoWhitelistOnChain(mint: string, tokenData: TokenVerificationResult): Promise<boolean> {
    if (!this.program || !this.adminKeypair) {
      throw new Error('Auto-whitelist not initialized');
    }

    // PROGRAM_ID is already a PublicKey, don't create a new one
    const programId = PROGRAM_ID;
    const mintPubkey = new PublicKey(mint);

    console.log(`[TokenVerification] Creating PDAs for auto-whitelist:`);
    console.log(`  - Program ID: ${programId.toString()}`);
    console.log(`  - Mint: ${mintPubkey.toString()}`);

    const [protocolState] = PublicKey.findProgramAddressSync(
      [Buffer.from('protocol_state')],
      programId
    );
    console.log(`  - Protocol State PDA: ${protocolState.toString()}`);

    const [tokenConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_config'), mintPubkey.toBuffer()],
      programId
    );
    console.log(`  - Token Config PDA: ${tokenConfig.toString()}`);

    // Tier: 0=bronze, 1=silver, 2=gold
    const tierMap: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };
    const tier = tierMap[tokenData.tier?.toLowerCase() || 'bronze'] ?? 0;

    // Pool type: 3=pumpswap (migrated tokens only)
    // Note: Pool type 2 (pumpfun) is blocked - tokens must migrate first
    const poolType = 3;

    // Derive the correct bonding curve PDA for PumpFun
    const bondingCurve = getPumpFunBondingCurve(mintPubkey);
    console.log(`  - Bonding Curve PDA: ${bondingCurve.toString()}`);
    console.log(`  - Admin: ${this.adminKeypair.publicKey.toString()}`);

    try {
      console.log(`[TokenVerification] Program instance:`, !!this.program);
      console.log(`[TokenVerification] Program methods:`, !!this.program.methods);
      
      const tx = await (this.program.methods as any)
        .whitelistToken(
          tier,
          bondingCurve, // Use bonding curve PDA, not mint address
          poolType,
          new BN(1000000),       // min loan: 0.001 SOL
          new BN(100000000000),  // max loan: 100 SOL
          false,                 // is_protocol_token: false for regular tokens
        )
        .accounts({
          protocolState,
          tokenConfig,
          tokenMint: mintPubkey,
          admin: this.adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log(`[TokenVerification] Auto-whitelisted - tx: ${tx.substring(0, 8)}...`);
      
      // Insert into database so loan.service.ts can find it
      try {
        await prisma.token.upsert({
          where: { id: mint },
          update: {
            enabled: true,
            tier: tokenData.tier?.toLowerCase() || 'bronze',
            updatedAt: new Date(),
          },
          create: {
            id: mint,
            symbol: tokenData.symbol || 'PUMP',
            name: tokenData.name || 'PumpFun Token',
            decimals: 6, // PumpFun tokens use 6 decimals
            tier: tokenData.tier?.toLowerCase() || 'bronze',
            poolAddress: bondingCurve.toString(), // Store bonding curve PDA
            enabled: true,
          },
        });
        console.log(`[TokenVerification] Token added to database: ${mint.substring(0, 8)}...`);
      } catch (dbError: any) {
        console.warn(`[TokenVerification] Failed to add token to database: ${dbError.message}`);
        // Don't throw - on-chain whitelist succeeded, that's what matters
      }
      
      return true;
    } catch (error: any) {
      console.error(`[TokenVerification] Auto-whitelist error:`, error);
      console.error(`[TokenVerification] Error stack:`, error.stack);
      if (error.message?.includes('already in use')) {
        return true;
      }
      throw error;
    }
  }

  clearCache(mint?: string): void {
    if (mint) {
      delete this.cache[mint];
    } else {
      this.cache = {};
    }
  }

  /**
   * Validate pool balance ratio to ensure sufficient sell-side liquidity.
   * Rejects if pool has >80% token and <20% SOL/USD1.
   */
  private async validatePoolBalance(
    mint: string,
    dexType: 'pumpfun' | 'raydium'
  ): Promise<{
    isValid: boolean;
    reason?: string;
    rejectionCode?: TokenRejectionCode;
    poolBalance?: PoolBalanceInfo;
    liquidity?: number;
    symbol?: string;
    name?: string;
    pairAddress?: string;
  }> {
    try {
      // Fetch pool data from DexScreener
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
        { signal: AbortSignal.timeout(10000) }
      );

      if (!response.ok) {
        console.warn(`[PoolValidation] DexScreener API error: ${response.status}`);
        // Fail open if API unavailable
        return { isValid: true };
      }

      const data = await response.json() as DexScreenerResponse;

      if (!data.pairs || data.pairs.length === 0) {
        return {
          isValid: false,
          reason: 'No liquidity pool found for this token. The token must have an active trading pool.',
          rejectionCode: 'INSUFFICIENT_LIQUIDITY',
        };
      }

      // Filter for valid quote tokens based on DEX type
      const validPools = data.pairs.filter(pair => {
        const quoteAddress = pair.quoteToken.address;
        
        // PumpFun tokens: SOL pairs only
        if (dexType === 'pumpfun') {
          return quoteAddress === VALID_QUOTE_TOKENS.SOL;
        }
        
        // Bonk/Raydium tokens: SOL or USD1 pairs
        return (
          quoteAddress === VALID_QUOTE_TOKENS.SOL ||
          quoteAddress === VALID_QUOTE_TOKENS.USD1
        );
      });

      if (validPools.length === 0) {
        const acceptedQuotes = dexType === 'pumpfun' ? 'SOL' : 'SOL or USD1';
        return {
          isValid: false,
          reason: `Token must be paired with ${acceptedQuotes}. Found pairs with: ${data.pairs.map(p => p.quoteToken.symbol).join(', ')}`,
          rejectionCode: 'NOT_SUPPORTED_DEX',
        };
      }

      // Get the pool with highest liquidity
      const bestPool = validPools.reduce((best, current) => {
        return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
      });

      const totalLiquidity = bestPool.liquidity?.usd || 0;

      // Check minimum liquidity
      if (totalLiquidity < MIN_LIQUIDITY_USD) {
        return {
          isValid: false,
          reason: `Insufficient liquidity: $${totalLiquidity.toLocaleString()}. Minimum $${MIN_LIQUIDITY_USD.toLocaleString()} required.`,
          rejectionCode: 'INSUFFICIENT_LIQUIDITY',
          liquidity: totalLiquidity,
        };
      }

      // Check token age (must be at least 24 hours old)
      if (bestPool.pairCreatedAt) {
        const ageMs = Date.now() - bestPool.pairCreatedAt;
        const ageHours = ageMs / (1000 * 60 * 60);
        
        if (ageHours < MIN_TOKEN_AGE_HOURS) {
          const hoursRemaining = Math.ceil(MIN_TOKEN_AGE_HOURS - ageHours);
          const minutesOld = Math.floor(ageMs / (1000 * 60));
          
          let ageDisplay: string;
          if (minutesOld < 60) {
            ageDisplay = `${minutesOld} minutes`;
          } else {
            ageDisplay = `${Math.floor(ageHours)} hours`;
          }
          
          return {
            isValid: false,
            reason: `Token is too new (${ageDisplay} old). Must be at least ${MIN_TOKEN_AGE_HOURS} hours old for safety. Try again in ~${hoursRemaining} hour${hoursRemaining > 1 ? 's' : ''}.`,
            rejectionCode: 'TOKEN_TOO_NEW',
            liquidity: totalLiquidity,
            symbol: bestPool.baseToken.symbol,
            name: bestPool.baseToken.name,
          };
        }
      }

      // Calculate pool balance ratio
      const baseBalance = bestPool.liquidity?.base || 0;  // Token amount
      const quoteBalance = bestPool.liquidity?.quote || 0; // SOL/USD1 amount

      if (baseBalance > 0 && quoteBalance > 0) {
        const tokenPriceUsd = parseFloat(bestPool.priceUsd || '0');
        const quotePriceUsd = await this.getQuoteTokenPrice(bestPool.quoteToken.address);

        const baseValueUsd = baseBalance * tokenPriceUsd;
        const quoteValueUsd = quoteBalance * quotePriceUsd;
        const totalValueUsd = baseValueUsd + quoteValueUsd;

        if (totalValueUsd > 0) {
          const basePercent = (baseValueUsd / totalValueUsd) * 100;
          const quotePercent = (quoteValueUsd / totalValueUsd) * 100;

          const poolBalance: PoolBalanceInfo = {
            baseTokenBalance: baseBalance,
            quoteTokenBalance: quoteBalance,
            baseTokenPercent: Math.round(basePercent * 100) / 100,
            quoteTokenPercent: Math.round(quotePercent * 100) / 100,
            quoteToken: bestPool.quoteToken.symbol,
            isBalanced: basePercent <= MAX_TOKEN_RATIO_PERCENT && quotePercent >= MIN_QUOTE_RATIO_PERCENT,
          };

          // Check if pool is imbalanced
          if (!poolBalance.isBalanced) {
            return {
              isValid: false,
              reason: `Pool is imbalanced: ${basePercent.toFixed(1)}% ${bestPool.baseToken.symbol} / ${quotePercent.toFixed(1)}% ${poolBalance.quoteToken}. Minimum ${MIN_QUOTE_RATIO_PERCENT}% ${poolBalance.quoteToken} required for safe liquidation.`,
              rejectionCode: 'POOL_IMBALANCED',
              poolBalance,
              liquidity: totalLiquidity,
            };
          }

          // Pool is valid!
          return {
            isValid: true,
            poolBalance,
            liquidity: totalLiquidity,
            symbol: bestPool.baseToken.symbol,
            name: bestPool.baseToken.name,
            pairAddress: bestPool.pairAddress,
          };
        }
      }

      // Fallback: allow if we can't calculate ratio but liquidity is sufficient
      return {
        isValid: true,
        liquidity: totalLiquidity,
        symbol: bestPool.baseToken.symbol,
        name: bestPool.baseToken.name,
        pairAddress: bestPool.pairAddress,
      };

    } catch (error) {
      console.error(`[PoolValidation] Error checking pool balance:`, error);
      // Fail open - allow token if we can't verify
      return { isValid: true };
    }
  }

  /**
   * Get USD price for a quote token
   */
  private async getQuoteTokenPrice(quoteTokenAddress: string): Promise<number> {
    // USD1/USDC is always ~$1
    if (quoteTokenAddress === VALID_QUOTE_TOKENS.USD1) {
      return 1;
    }

    // For SOL, fetch current price
    if (quoteTokenAddress === VALID_QUOTE_TOKENS.SOL) {
      try {
        const response = await fetch(
          'https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112',
          { signal: AbortSignal.timeout(5000) }
        );
        const data = await response.json() as any;
        return data?.data?.['So11111111111111111111111111111111111111112']?.price || 150;
      } catch {
        return 150; // Fallback price
      }
    }

    return 1; // Unknown - assume $1
  }

  /**
   * Determine tier based on liquidity
   */
  private determineTier(liquidityUsd: number): TokenTier {
    if (liquidityUsd >= 300000) return TokenTier.Gold;
    if (liquidityUsd >= 100000) return TokenTier.Silver;
    return TokenTier.Bronze;
  }

  /**
   * Get LTV for tier
   */
  private getLtvForTier(tier: TokenTier): number {
    switch (tier) {
      case TokenTier.Gold: return 5000;   // 50%
      case TokenTier.Silver: return 3500; // 35%
      case TokenTier.Bronze: return 2500; // 25%
      default: return 2500;
    }
  }
}

export const tokenVerificationService = new TokenVerificationService();