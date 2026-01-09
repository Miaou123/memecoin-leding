#!/usr/bin/env npx tsx

/**
 * Test PumpSwap Pool Discovery - On-Chain Methods
 * 
 * Tests multiple approaches to find PumpSwap pools without relying on DexScreener
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Expected Pool discriminator from IDL
const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];

// Test cases
const TEST_CASES = [
  {
    tokenMint: 'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump',
    expectedPool: '4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ',
    name: 'Legacy SPL Token'
  },
  {
    tokenMint: 'CmgJ1PobhUqB7MEa8qDkiG2TUpMTskWj8d9JeZWSpump',
    expectedPool: '7YW47DAivaQxHHYVRsP2eGzMcAMGx4czhdJ7XEFUMoYs',
    name: 'Token-2022'
  }
];

/**
 * Approach 1: getProgramAccounts with memcmp filter
 */
async function approach1_memcmpFilter(connection: Connection, tokenMint: PublicKey): Promise<PublicKey | null> {
  console.log('\n📡 Approach 1: getProgramAccounts with memcmp filter');
  
  try {
    // Try filtering by base_mint at offset 43
    const accounts = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
      filters: [
        { dataSize: 301 },
        { memcmp: { offset: 43, bytes: tokenMint.toBase58() } },
      ],
    });
    
    console.log(`   Found ${accounts.length} accounts with base_mint = ${tokenMint.toBase58()}`);
    
    if (accounts.length > 0) {
      const poolAddress = accounts[0].pubkey;
      console.log(`   ✅ Found pool: ${poolAddress.toBase58()}`);
      return poolAddress;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return null;
}

/**
 * Approach 2: Derive PDA directly
 */
async function approach2_derivePDA(connection: Connection, tokenMint: PublicKey): Promise<PublicKey | null> {
  console.log('\n📡 Approach 2: Derive PDA directly');
  
  try {
    // First, fetch known pools to identify creators
    const knownPools = [
      new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ'),
      new PublicKey('7YW47DAivaQxHHYVRsP2eGzMcAMGx4czhdJ7XEFUMoYs'),
    ];
    
    const creators = new Set<string>();
    
    for (const poolAddress of knownPools) {
      const poolAccount = await connection.getAccountInfo(poolAddress);
      if (poolAccount && poolAccount.data.length >= 43) {
        // Extract creator at offset 11
        const creator = new PublicKey(poolAccount.data.slice(11, 43));
        creators.add(creator.toBase58());
        console.log(`   Found creator: ${creator.toBase58()}`);
      }
    }
    
    // Try different index values for each creator
    for (const creatorStr of creators) {
      const creator = new PublicKey(creatorStr);
      
      for (let index = 0; index < 100; index++) {
        const [poolPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from('pool'),
            Buffer.from([index & 0xff, (index >> 8) & 0xff]), // u16 little endian
            creator.toBuffer(),
            tokenMint.toBuffer(),
            WSOL_MINT.toBuffer(),
          ],
          PUMPSWAP_PROGRAM_ID
        );
        
        // Check if this PDA exists
        const account = await connection.getAccountInfo(poolPda);
        if (account) {
          console.log(`   ✅ Found pool PDA at index ${index}: ${poolPda.toBase58()}`);
          return poolPda;
        }
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return null;
}

/**
 * Approach 3: Search by quote_mint (WSOL)
 */
async function approach3_searchByQuoteMint(connection: Connection, tokenMint: PublicKey): Promise<PublicKey | null> {
  console.log('\n📡 Approach 3: Search by quote_mint (WSOL)');
  
  try {
    // Search for all pools with WSOL as quote mint
    const accounts = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
      filters: [
        { dataSize: 301 },
        { memcmp: { offset: 75, bytes: WSOL_MINT.toBase58() } },
      ],
    });
    
    console.log(`   Found ${accounts.length} pools with WSOL as quote mint`);
    
    // Filter locally for base_mint match
    for (const { pubkey, account } of accounts) {
      const baseMint = new PublicKey(account.data.slice(43, 75));
      if (baseMint.equals(tokenMint)) {
        console.log(`   ✅ Found pool: ${pubkey.toBase58()}`);
        return pubkey;
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return null;
}

/**
 * Approach 4: Use getMultipleAccountsInfo with derived PDAs
 */
async function approach4_multipleAccountsInfo(connection: Connection, tokenMint: PublicKey): Promise<PublicKey | null> {
  console.log('\n📡 Approach 4: getMultipleAccountsInfo with derived PDAs');
  
  try {
    // Get known creators first
    const knownCreators = await getKnownCreators(connection);
    
    // Generate possible PDAs
    const possiblePdas: PublicKey[] = [];
    const pdaInfo: Map<string, { creator: PublicKey, index: number }> = new Map();
    
    for (const creator of knownCreators) {
      for (let index = 0; index < 10; index++) {
        const [pda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from('pool'),
            Buffer.from([index & 0xff, (index >> 8) & 0xff]),
            creator.toBuffer(),
            tokenMint.toBuffer(),
            WSOL_MINT.toBuffer(),
          ],
          PUMPSWAP_PROGRAM_ID
        );
        possiblePdas.push(pda);
        pdaInfo.set(pda.toBase58(), { creator, index });
      }
    }
    
    // Check multiple accounts at once
    const accounts = await connection.getMultipleAccountsInfo(possiblePdas);
    
    for (let i = 0; i < accounts.length; i++) {
      if (accounts[i] !== null) {
        const poolAddress = possiblePdas[i];
        const info = pdaInfo.get(poolAddress.toBase58());
        console.log(`   ✅ Found pool: ${poolAddress.toBase58()}`);
        console.log(`      Creator: ${info?.creator.toBase58()}`);
        console.log(`      Index: ${info?.index}`);
        return poolAddress;
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return null;
}

/**
 * Approach 5: Analyze known pools to find patterns
 */
async function approach5_analyzeKnownPools(connection: Connection, tokenMint: PublicKey): Promise<PublicKey | null> {
  console.log('\n📡 Approach 5: Analyze known pools for patterns');
  
  try {
    const knownPools = [
      { address: '4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ', token: 'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump' },
      { address: '7YW47DAivaQxHHYVRsP2eGzMcAMGx4czhdJ7XEFUMoYs', token: 'CmgJ1PobhUqB7MEa8qDkiG2TUpMTskWj8d9JeZWSpump' },
    ];
    
    let commonCreator: PublicKey | null = null;
    const indices: Map<string, number> = new Map();
    
    for (const { address, token } of knownPools) {
      const poolAccount = await connection.getAccountInfo(new PublicKey(address));
      if (!poolAccount || poolAccount.data.length < 211) continue;
      
      // Extract data
      const index = poolAccount.data.readUInt16LE(9);
      const creator = new PublicKey(poolAccount.data.slice(11, 43));
      
      console.log(`   Pool ${address.slice(0, 8)}...`);
      console.log(`      Index: ${index}`);
      console.log(`      Creator: ${creator.toBase58()}`);
      
      indices.set(token, index);
      
      if (!commonCreator) {
        commonCreator = creator;
      } else if (!commonCreator.equals(creator)) {
        console.log(`      ⚠️ Different creator than previous pool`);
      }
    }
    
    // If we found a common creator, try to derive the PDA
    if (commonCreator) {
      console.log(`\n   Common creator found: ${commonCreator.toBase58()}`);
      
      // Try a range of indices
      for (let index = 0; index < 1000; index++) {
        const [pda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from('pool'),
            Buffer.from([index & 0xff, (index >> 8) & 0xff]),
            commonCreator.toBuffer(),
            tokenMint.toBuffer(),
            WSOL_MINT.toBuffer(),
          ],
          PUMPSWAP_PROGRAM_ID
        );
        
        const account = await connection.getAccountInfo(pda);
        if (account) {
          console.log(`   ✅ Found pool at index ${index}: ${pda.toBase58()}`);
          return pda;
        }
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return null;
}

/**
 * Helper: Get known creators from known pools
 */
async function getKnownCreators(connection: Connection): Promise<PublicKey[]> {
  const knownPools = [
    new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ'),
    new PublicKey('7YW47DAivaQxHHYVRsP2eGzMcAMGx4czhdJ7XEFUMoYs'),
  ];
  
  const creators = new Set<string>();
  
  for (const poolAddress of knownPools) {
    const poolAccount = await connection.getAccountInfo(poolAddress);
    if (poolAccount && poolAccount.data.length >= 43) {
      const creator = new PublicKey(poolAccount.data.slice(11, 43));
      creators.add(creator.toBase58());
    }
  }
  
  return Array.from(creators).map(c => new PublicKey(c));
}

/**
 * DexScreener fallback (for comparison)
 */
async function dexScreenerFallback(tokenMint: string): Promise<string | null> {
  console.log('\n🌐 DexScreener fallback (for comparison only)');
  
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    const data = await response.json();
    
    if (data.pairs && data.pairs.length > 0) {
      for (const pair of data.pairs) {
        if (pair.dexId === 'pumpswap' && pair.quoteToken?.symbol === 'SOL') {
          console.log(`   Found pool: ${pair.pairAddress}`);
          return pair.pairAddress;
        }
      }
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }
  
  return null;
}

/**
 * Main test function
 */
async function testPoolDiscovery(tokenMintStr: string) {
  const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  console.log(`\n🔗 Using RPC: ${RPC_URL}`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const tokenMint = new PublicKey(tokenMintStr);
  
  const testCase = TEST_CASES.find(tc => tc.tokenMint === tokenMintStr);
  
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 Testing Pool Discovery for: ${tokenMintStr}`);
  if (testCase) {
    console.log(`   Name: ${testCase.name}`);
    console.log(`   Expected Pool: ${testCase.expectedPool}`);
  }
  console.log('='.repeat(80));
  
  let foundPool: PublicKey | null = null;
  
  // Try each approach in order
  const approaches = [
    approach1_memcmpFilter,
    approach2_derivePDA,
    approach3_searchByQuoteMint,
    approach4_multipleAccountsInfo,
    approach5_analyzeKnownPools,
  ];
  
  for (const approach of approaches) {
    foundPool = await approach(connection, tokenMint);
    if (foundPool) {
      break;
    }
  }
  
  // Compare with DexScreener
  const dexScreenerPool = await dexScreenerFallback(tokenMintStr);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 RESULTS:');
  console.log('='.repeat(80));
  
  if (foundPool) {
    console.log(`📡 On-chain method: ✅ Found pool ${foundPool.toBase58()}`);
    
    if (testCase && foundPool.toBase58() === testCase.expectedPool) {
      console.log(`✅ MATCHES expected pool!`);
    } else if (testCase) {
      console.log(`❌ DOES NOT MATCH expected pool ${testCase.expectedPool}`);
    }
  } else {
    console.log(`📡 On-chain method: ❌ Pool not found`);
  }
  
  if (dexScreenerPool) {
    console.log(`🌐 DexScreener: Found pool ${dexScreenerPool}`);
    
    if (foundPool && foundPool.toBase58() === dexScreenerPool) {
      console.log(`✅ Results match!`);
    } else if (foundPool) {
      console.log(`⚠️ Results differ!`);
    }
  }
  
  return foundPool !== null;
}

/**
 * Entry point
 */
async function main() {
  const tokenMint = process.argv[2];
  
  if (!tokenMint) {
    console.log('Usage: npx tsx scripts/test-pumpswap-pool-discovery.ts <token-mint>');
    console.log('\nTest cases:');
    for (const tc of TEST_CASES) {
      console.log(`  ${tc.tokenMint} - ${tc.name}`);
    }
    process.exit(1);
  }
  
  try {
    const success = await testPoolDiscovery(tokenMint);
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();