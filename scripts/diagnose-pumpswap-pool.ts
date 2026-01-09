#!/usr/bin/env npx tsx

/**
 * Diagnose PumpSwap Pool Structure
 * 
 * Fetches a known pool and examines its actual byte layout
 * to understand why getProgramAccounts isn't finding it.
 */

import { Connection, PublicKey } from '@solana/web3.js';

const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Expected Pool discriminator from IDL
const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];

async function main() {
  const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Known working pool from DexScreener
  const knownPoolAddress = process.argv[2] || '4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ';
  const expectedBaseMint = process.argv[3] || 'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump';
  
  console.log('🔬 PumpSwap Pool Structure Diagnostic');
  console.log('=====================================\n');
  console.log(`Pool address: ${knownPoolAddress}`);
  console.log(`Expected base mint: ${expectedBaseMint}\n`);
  
  // Fetch the pool account
  const poolPubkey = new PublicKey(knownPoolAddress);
  const poolAccount = await connection.getAccountInfo(poolPubkey);
  
  if (!poolAccount) {
    console.log('❌ Pool account not found!');
    return;
  }
  
  console.log('📊 Pool Account Info:');
  console.log(`   Owner: ${poolAccount.owner.toString()}`);
  console.log(`   Is PumpSwap program? ${poolAccount.owner.equals(PUMPSWAP_PROGRAM_ID) ? '✅ YES' : '❌ NO'}`);
  console.log(`   Data length: ${poolAccount.data.length} bytes`);
  console.log(`   Lamports: ${poolAccount.lamports}`);
  
  const data = poolAccount.data;
  
  // Check discriminator
  console.log('\n📋 Discriminator (first 8 bytes):');
  const actualDiscriminator = Array.from(data.slice(0, 8));
  console.log(`   Expected: [${POOL_DISCRIMINATOR.join(', ')}]`);
  console.log(`   Actual:   [${actualDiscriminator.join(', ')}]`);
  console.log(`   Match: ${JSON.stringify(actualDiscriminator) === JSON.stringify(POOL_DISCRIMINATOR) ? '✅ YES' : '❌ NO'}`);
  
  // Parse according to IDL layout
  console.log('\n📋 Parsing with IDL layout (expected offsets):');
  
  const layouts = [
    { name: 'discriminator', offset: 0, size: 8, type: 'bytes' },
    { name: 'pool_bump', offset: 8, size: 1, type: 'u8' },
    { name: 'index', offset: 9, size: 2, type: 'u16' },
    { name: 'creator', offset: 11, size: 32, type: 'pubkey' },
    { name: 'base_mint', offset: 43, size: 32, type: 'pubkey' },
    { name: 'quote_mint', offset: 75, size: 32, type: 'pubkey' },
    { name: 'lp_mint', offset: 107, size: 32, type: 'pubkey' },
    { name: 'pool_base_token_account', offset: 139, size: 32, type: 'pubkey' },
    { name: 'pool_quote_token_account', offset: 171, size: 32, type: 'pubkey' },
    { name: 'lp_supply', offset: 203, size: 8, type: 'u64' },
  ];
  
  for (const field of layouts) {
    const slice = data.slice(field.offset, field.offset + field.size);
    let value: string;
    
    if (field.type === 'pubkey') {
      value = new PublicKey(slice).toString();
    } else if (field.type === 'u8') {
      value = slice.readUInt8(0).toString();
    } else if (field.type === 'u16') {
      value = slice.readUInt16LE(0).toString();
    } else if (field.type === 'u64') {
      value = slice.readBigUInt64LE(0).toString();
    } else {
      value = `[${Array.from(slice).join(', ')}]`;
    }
    
    let marker = '';
    if (field.name === 'base_mint') {
      marker = value === expectedBaseMint ? ' ✅ MATCHES' : ' ❌ NO MATCH';
    }
    if (field.name === 'quote_mint') {
      marker = value === WSOL_MINT.toString() ? ' ✅ WSOL' : ' ⚠️ NOT WSOL';
    }
    
    console.log(`   ${field.name} (offset ${field.offset}): ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}${marker}`);
  }
  
  // Now let's try to find where the base_mint actually is
  console.log('\n🔍 Searching for base_mint in pool data...');
  const baseMintBytes = new PublicKey(expectedBaseMint).toBytes();
  
  for (let i = 0; i <= data.length - 32; i++) {
    const slice = data.slice(i, i + 32);
    if (Buffer.compare(slice, Buffer.from(baseMintBytes)) === 0) {
      console.log(`   ✅ Found base_mint at offset ${i}`);
    }
  }
  
  // Search for WSOL mint
  console.log('\n🔍 Searching for WSOL mint in pool data...');
  const wsolBytes = WSOL_MINT.toBytes();
  
  for (let i = 0; i <= data.length - 32; i++) {
    const slice = data.slice(i, i + 32);
    if (Buffer.compare(slice, Buffer.from(wsolBytes)) === 0) {
      console.log(`   ✅ Found WSOL at offset ${i}`);
    }
  }
  
  // Try getProgramAccounts with just the discriminator filter
  console.log('\n🔎 Testing getProgramAccounts filters...');
  
  console.log('\n   Test 1: dataSize filter only...');
  const test1 = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
    filters: [{ dataSize: data.length }],
    dataSlice: { offset: 0, length: 0 }, // Don't fetch data, just count
  });
  console.log(`   Found ${test1.length} accounts with size ${data.length}`);
  
  console.log('\n   Test 2: discriminator filter...');
  const discriminatorBase58 = Buffer.from(POOL_DISCRIMINATOR).toString('base64');
  const test2 = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: Buffer.from(POOL_DISCRIMINATOR).toString('base64') } },
    ],
    dataSlice: { offset: 0, length: 0 },
  });
  console.log(`   Found ${test2.length} accounts with Pool discriminator`);
  
  // Final recommendation
  console.log('\n' + '='.repeat(60));
  console.log('📋 DIAGNOSTIC COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);