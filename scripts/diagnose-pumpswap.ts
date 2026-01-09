#!/usr/bin/env npx tsx

/**
 * Test PumpSwap Pool Discovery (FIXED)
 * 
 * Tests finding PumpSwap pools via on-chain query and DexScreener fallback.
 * 
 * Usage: 
 *   npx tsx scripts/test-pumpswap-pool-discovery.ts <token-mint>
 *   npx tsx scripts/test-pumpswap-pool-discovery.ts  # uses default test tokens
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

// Load .env file
dotenv.config();

// ============================================================
// CONSTANTS (CORRECTED FROM DIAGNOSTIC)
// ============================================================

const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Pool discriminator from IDL
const POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);

// CORRECTED: Actual pool size is 301 bytes (not 211 as in IDL)
const POOL_SIZE = 301;

// Pool layout offsets (verified correct from diagnostic)
const POOL_BUMP_OFFSET = 8;
const POOL_INDEX_OFFSET = 9;
const POOL_CREATOR_OFFSET = 11;
const POOL_BASE_MINT_OFFSET = 43;
const POOL_QUOTE_MINT_OFFSET = 75;
const POOL_LP_MINT_OFFSET = 107;
const POOL_BASE_VAULT_OFFSET = 139;
const POOL_QUOTE_VAULT_OFFSET = 171;
const POOL_LP_SUPPLY_OFFSET = 203;

// Token account amount offset
const TOKEN_AMOUNT_OFFSET = 64;

// ============================================================
// POOL DISCOVERY METHODS
// ============================================================

/**
 * Method 1: Find PumpSwap pool using getProgramAccounts with memcmp filter
 * This queries on-chain directly - most reliable
 */
async function findPoolOnChain(
  connection: Connection,
  tokenMint: PublicKey
): Promise<{ pubkey: PublicKey; data: Buffer }[]> {
  console.log('\n📡 Method 1: Querying on-chain via getProgramAccounts...');
  
  const startTime = Date.now();
  
  try {
    const accounts = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
      filters: [
        { dataSize: POOL_SIZE },
        { memcmp: { offset: POOL_BASE_MINT_OFFSET, bytes: tokenMint.toBase58() } },
      ],
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`   Query took ${elapsed}ms, found ${accounts.length} pool(s)`);
    
    return accounts.map(acc => ({ pubkey: acc.pubkey, data: acc.account.data as Buffer }));
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return [];
  }
}

/**
 * Method 2: Find pool via DexScreener API
 */
async function findPoolViaDexScreener(
  tokenMint: string
): Promise<{ address: string; liquidity: number }[]> {
  console.log('\n🌐 Method 2: Querying DexScreener API...');
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
      { signal: AbortSignal.timeout(10000) }
    );
    
    if (!response.ok) {
      console.log(`   ❌ API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const elapsed = Date.now() - startTime;
    
    const pumpswapPools = (data.pairs || [])
      .filter((p: any) => p.dexId === 'pumpswap')
      .map((p: any) => ({
        address: p.pairAddress,
        liquidity: p.liquidity?.usd || 0,
      }));
    
    console.log(`   Query took ${elapsed}ms, found ${pumpswapPools.length} PumpSwap pool(s)`);
    
    return pumpswapPools;
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return [];
  }
}

/**
 * Method 3: Derive pool PDA (requires knowing creator and index)
 */
function derivePoolPDA(
  index: number,
  creator: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey = WSOL_MINT
): [PublicKey, number] {
  const indexBuffer = Buffer.alloc(2);
  indexBuffer.writeUInt16LE(index);
  
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      indexBuffer,
      creator.toBuffer(),
      baseMint.toBuffer(),
      quoteMint.toBuffer(),
    ],
    PUMPSWAP_PROGRAM_ID
  );
}

// ============================================================
// POOL DATA PARSING
// ============================================================

interface ParsedPoolData {
  poolBump: number;
  index: number;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  lpSupply: bigint;
}

function parsePoolData(data: Buffer): ParsedPoolData {
  return {
    poolBump: data.readUInt8(POOL_BUMP_OFFSET),
    index: data.readUInt16LE(POOL_INDEX_OFFSET),
    creator: new PublicKey(data.slice(POOL_CREATOR_OFFSET, POOL_CREATOR_OFFSET + 32)),
    baseMint: new PublicKey(data.slice(POOL_BASE_MINT_OFFSET, POOL_BASE_MINT_OFFSET + 32)),
    quoteMint: new PublicKey(data.slice(POOL_QUOTE_MINT_OFFSET, POOL_QUOTE_MINT_OFFSET + 32)),
    lpMint: new PublicKey(data.slice(POOL_LP_MINT_OFFSET, POOL_LP_MINT_OFFSET + 32)),
    baseVault: new PublicKey(data.slice(POOL_BASE_VAULT_OFFSET, POOL_BASE_VAULT_OFFSET + 32)),
    quoteVault: new PublicKey(data.slice(POOL_QUOTE_VAULT_OFFSET, POOL_QUOTE_VAULT_OFFSET + 32)),
    lpSupply: data.readBigUInt64LE(POOL_LP_SUPPLY_OFFSET),
  };
}

// ============================================================
// VALIDATION
// ============================================================

async function validatePool(
  connection: Connection,
  poolAddress: PublicKey,
  poolData: ParsedPoolData
): Promise<{ valid: boolean; baseBalance?: bigint; quoteBalance?: bigint; error?: string }> {
  console.log('\n🔍 Validating pool...');
  
  // Check vaults exist and have balances
  const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
    connection.getAccountInfo(poolData.baseVault),
    connection.getAccountInfo(poolData.quoteVault),
  ]);
  
  if (!baseVaultInfo) {
    return { valid: false, error: 'Base vault account not found' };
  }
  
  if (!quoteVaultInfo) {
    return { valid: false, error: 'Quote vault account not found' };
  }
  
  if (baseVaultInfo.data.length < TOKEN_AMOUNT_OFFSET + 8) {
    return { valid: false, error: `Base vault data too small: ${baseVaultInfo.data.length}` };
  }
  
  if (quoteVaultInfo.data.length < TOKEN_AMOUNT_OFFSET + 8) {
    return { valid: false, error: `Quote vault data too small: ${quoteVaultInfo.data.length}` };
  }
  
  const baseBalance = baseVaultInfo.data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
  const quoteBalance = quoteVaultInfo.data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
  
  // Verify quote mint is WSOL
  if (!poolData.quoteMint.equals(WSOL_MINT)) {
    return { 
      valid: false, 
      error: `Quote mint is not WSOL: ${poolData.quoteMint.toString()}`,
      baseBalance,
      quoteBalance,
    };
  }
  
  return { valid: true, baseBalance, quoteBalance };
}

// ============================================================
// MAIN TEST FUNCTION
// ============================================================

async function testToken(connection: Connection, tokenMint: string): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log(`🪙 Testing token: ${tokenMint}`);
  console.log('═'.repeat(70));
  
  const mintPubkey = new PublicKey(tokenMint);
  
  // Method 1: On-chain query
  const onChainPools = await findPoolOnChain(connection, mintPubkey);
  
  if (onChainPools.length > 0) {
    for (const pool of onChainPools) {
      console.log(`\n   ✅ Found on-chain: ${pool.pubkey.toString()}`);
      
      const parsed = parsePoolData(pool.data);
      console.log(`      Pool bump: ${parsed.poolBump}`);
      console.log(`      Index: ${parsed.index}`);
      console.log(`      Creator: ${parsed.creator.toString()}`);
      console.log(`      Base mint: ${parsed.baseMint.toString()}`);
      console.log(`      Quote mint: ${parsed.quoteMint.toString()}`);
      console.log(`      Base vault: ${parsed.baseVault.toString()}`);
      console.log(`      Quote vault: ${parsed.quoteVault.toString()}`);
      console.log(`      LP supply: ${parsed.lpSupply.toString()}`);
      
      // Validate
      const validation = await validatePool(connection, pool.pubkey, parsed);
      if (validation.valid) {
        const baseBalanceFormatted = Number(validation.baseBalance) / 1e6;
        const quoteBalanceFormatted = Number(validation.quoteBalance) / 1e9;
        console.log(`\n   ✅ Pool is VALID`);
        console.log(`      Base balance: ${baseBalanceFormatted.toLocaleString()} tokens`);
        console.log(`      Quote balance: ${quoteBalanceFormatted.toFixed(4)} SOL`);
        
        // Calculate price
        if (validation.baseBalance && validation.baseBalance > 0n) {
          const price = Number(validation.quoteBalance) / Number(validation.baseBalance) * 1000; // Adjust for decimal diff
          console.log(`      Price: ${price.toExponential(4)} SOL per token`);
        }
        
        // Verify PDA derivation works
        console.log('\n   🔑 Verifying PDA derivation...');
        const [derivedPda, bump] = derivePoolPDA(parsed.index, parsed.creator, parsed.baseMint, parsed.quoteMint);
        if (derivedPda.equals(pool.pubkey)) {
          console.log(`      ✅ PDA derivation matches! (bump: ${bump})`);
        } else {
          console.log(`      ❌ PDA derivation mismatch!`);
          console.log(`         Derived: ${derivedPda.toString()}`);
          console.log(`         Actual:  ${pool.pubkey.toString()}`);
        }
      } else {
        console.log(`\n   ❌ Pool validation failed: ${validation.error}`);
      }
    }
  } else {
    console.log('   ❌ No pools found on-chain');
  }
  
  // Method 2: DexScreener
  const dexScreenerPools = await findPoolViaDexScreener(tokenMint);
  
  if (dexScreenerPools.length > 0) {
    for (const pool of dexScreenerPools) {
      console.log(`\n   📊 DexScreener pool: ${pool.address}`);
      console.log(`      Liquidity: $${pool.liquidity.toLocaleString()}`);
      
      // Check if it matches on-chain result
      const matchesOnChain = onChainPools.some(p => p.pubkey.toString() === pool.address);
      if (matchesOnChain) {
        console.log(`      ✅ Matches on-chain result`);
      } else if (onChainPools.length > 0) {
        console.log(`      ⚠️  Does NOT match on-chain result`);
      }
    }
  } else {
    console.log('\n   ❌ No PumpSwap pools found on DexScreener');
  }
  
  // Summary
  console.log('\n' + '-'.repeat(70));
  console.log('📋 SUMMARY:');
  if (onChainPools.length > 0) {
    console.log(`   ✅ Recommended pool address: ${onChainPools[0].pubkey.toString()}`);
  } else if (dexScreenerPools.length > 0) {
    console.log(`   ⚠️  Fallback pool address: ${dexScreenerPools[0].address}`);
  } else {
    console.log('   ❌ No PumpSwap pool found for this token');
  }
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
  // Use RPC_URL from .env, fallback to public RPC
  const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('🔧 PumpSwap Pool Discovery Test (FIXED)');
  console.log('=======================================');
  console.log(`RPC: ${RPC_URL.substring(0, 50)}${RPC_URL.length > 50 ? '...' : ''}`);
  console.log(`Pool size filter: ${POOL_SIZE} bytes`);
  
  // Get token mints from args or use defaults
  let tokenMints = process.argv.slice(2);
  
  if (tokenMints.length === 0) {
    console.log('\nNo tokens provided, using test tokens...');
    tokenMints = [
      'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump', // Known working token
    ];
  }
  
  for (const mint of tokenMints) {
    try {
      await testToken(connection, mint);
    } catch (error: any) {
      console.error(`\n❌ Error testing ${mint}: ${error.message}`);
    }
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('✅ Test complete');
  console.log('═'.repeat(70));
}

main().catch(console.error);