import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { TokenTier } from '@memecoin-lending/types';
import {
  TokenVerificationResult,
  TokenVerificationCache,
} from '@memecoin-lending/types';
import { getNetworkConfig, PROGRAM_ID, NetworkType, PUMPFUN_PROGRAM_ID } from '@memecoin-lending/config';
import { manualWhitelistService } from './manual-whitelist.service';
import { prisma } from '../db/client.js';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import { getAdminKeypair } from '../config/keys.js';

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
        return this.createInvalidResult(mint, 'Invalid mint address format');
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

      // 4. Must end in "pump" (PumpFun token)
      if (!mint.toLowerCase().endsWith('pump')) {
        const result = this.createInvalidResult(mint, 'Token must be from PumpFun (address must end in "pump")');
        this.cacheResult(mint, result);
        return result;
      }

      console.log(`[TokenVerification] Valid PumpFun token: ${mint.substring(0, 8)}... (ends in pump)`);

      // 5. Check if already on-chain
      const isOnChain = await this.isTokenOnChain(mint);
      
      if (!isOnChain && this.autoWhitelistEnabled && this.adminKeypair) {
        console.log(`[TokenVerification] Not on-chain, auto-whitelisting...`);
        try {
          await this.autoWhitelistWithLock(mint, {
            isValid: true,
            mint,
            tier: TokenTier.Bronze,
            ltvBps: 5000,
            dexId: 'pumpfun',
            liquidity: 0,
            verifiedAt: Date.now(),
            isWhitelisted: false,
          });
          console.log(`[TokenVerification] Auto-whitelisted ${mint.substring(0, 8)}...`);
        } catch (error: any) {
          if (!error.message?.includes('already in use')) {
            console.error(`[TokenVerification] Auto-whitelist failed:`, error.message);
            return this.createInvalidResult(mint, 'Failed to whitelist token on-chain. Please try again.');
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

      // 6. Return success
      const result: TokenVerificationResult = {
        isValid: true,
        mint,
        tier: TokenTier.Bronze,
        ltvBps: 5000,
        liquidity: 0,
        dexId: 'pumpfun',
        verifiedAt: Date.now(),
        isWhitelisted: true,
        whitelistSource: 'auto',
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

    // Pool type: 2=pumpfun
    const poolType = 2;

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
}

export const tokenVerificationService = new TokenVerificationService();