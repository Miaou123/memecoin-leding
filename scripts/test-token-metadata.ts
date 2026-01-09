#!/usr/bin/env tsx
/**
 * Fetch token metadata from on-chain Metaplex Token Metadata
 * Run: npx tsx scripts/test-metaplex-metadata.ts <TOKEN_MINT>
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { config } from 'dotenv';

config();

const TOKEN_MINT = process.argv[2] || 'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump';

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * Derive the metadata PDA for a token mint
 */
function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Parse a string from Metaplex metadata buffer
 * Metaplex uses a 4-byte length prefix followed by the string data
 */
function parseMetaplexString(buffer: Buffer, offset: number): { value: string; newOffset: number } {
  const length = buffer.readUInt32LE(offset);
  const value = buffer.slice(offset + 4, offset + 4 + length).toString('utf8').replace(/\0/g, '').trim();
  return { value, newOffset: offset + 4 + length };
}

/**
 * Parse Metaplex Token Metadata from account data
 * 
 * Layout (v1.3.x):
 * - key: u8 (1 byte) - should be 4 for MetadataV1
 * - update_authority: Pubkey (32 bytes)
 * - mint: Pubkey (32 bytes)
 * - name: String (4 byte len + data, padded to 32 chars max)
 * - symbol: String (4 byte len + data, padded to 10 chars max)
 * - uri: String (4 byte len + data, padded to 200 chars max)
 * - ... more fields after
 */
function parseMetaplexMetadata(data: Buffer): { name: string; symbol: string; uri: string } | null {
  try {
    // Check key byte (should be 4 for MetadataV1)
    const key = data.readUInt8(0);
    if (key !== 4) {
      console.log(`  ⚠️ Unexpected metadata key: ${key} (expected 4)`);
    }

    // Skip: key (1) + update_authority (32) + mint (32) = 65 bytes
    let offset = 1 + 32 + 32;

    // Parse name
    const nameResult = parseMetaplexString(data, offset);
    offset = nameResult.newOffset;

    // Parse symbol  
    const symbolResult = parseMetaplexString(data, offset);
    offset = symbolResult.newOffset;

    // Parse URI
    const uriResult = parseMetaplexString(data, offset);

    return {
      name: nameResult.value,
      symbol: symbolResult.value,
      uri: uriResult.value,
    };
  } catch (error) {
    console.error('  ❌ Failed to parse metadata:', error);
    return null;
  }
}

/**
 * Fetch JSON metadata from URI (IPFS, Arweave, etc.)
 */
async function fetchJsonMetadata(uri: string): Promise<{ name?: string; symbol?: string; image?: string; description?: string } | null> {
  try {
    // Convert IPFS URI to HTTP gateway
    let fetchUrl = uri;
    if (uri.startsWith('ipfs://')) {
      fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    } else if (uri.startsWith('ar://')) {
      fetchUrl = uri.replace('ar://', 'https://arweave.net/');
    }

    console.log(`  📡 Fetching JSON from: ${fetchUrl}`);
    
    const response = await fetch(fetchUrl, { 
      signal: AbortSignal.timeout(10000),
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.log(`  ❌ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const json = await response.json();
    
    // Convert image IPFS URI if needed
    let image = json.image;
    if (image?.startsWith('ipfs://')) {
      image = image.replace('ipfs://', 'https://ipfs.io/ipfs/');
    } else if (image?.startsWith('ar://')) {
      image = image.replace('ar://', 'https://arweave.net/');
    }

    return {
      name: json.name,
      symbol: json.symbol,
      image,
      description: json.description,
    };
  } catch (error) {
    console.error(`  ❌ Failed to fetch JSON metadata:`, error);
    return null;
  }
}

async function main() {
  console.log('🔍 Fetching On-Chain Metaplex Token Metadata');
  console.log('=============================================\n');
  console.log(`Token Mint: ${TOKEN_MINT}\n`);

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );

  const mint = new PublicKey(TOKEN_MINT);
  const metadataPDA = getMetadataPDA(mint);
  
  console.log(`Metadata PDA: ${metadataPDA.toString()}\n`);

  // Fetch metadata account
  console.log('1️⃣  Fetching on-chain metadata account...');
  const accountInfo = await connection.getAccountInfo(metadataPDA);
  
  if (!accountInfo) {
    console.log('  ❌ No metadata account found for this token');
    return;
  }

  console.log(`  ✅ Found! Account size: ${accountInfo.data.length} bytes\n`);

  // Parse the metadata
  console.log('2️⃣  Parsing Metaplex metadata...');
  const metadata = parseMetaplexMetadata(accountInfo.data);
  
  if (!metadata) {
    console.log('  ❌ Failed to parse metadata');
    return;
  }

  console.log(`  ✅ Parsed successfully!`);
  console.log(`     Name: "${metadata.name}"`);
  console.log(`     Symbol: "${metadata.symbol}"`);
  console.log(`     URI: "${metadata.uri}"\n`);

  // Fetch the JSON metadata from URI
  if (metadata.uri) {
    console.log('3️⃣  Fetching off-chain JSON metadata...');
    const jsonMetadata = await fetchJsonMetadata(metadata.uri);
    
    if (jsonMetadata) {
      console.log(`  ✅ JSON metadata fetched!`);
      console.log(`     Name: "${jsonMetadata.name}"`);
      console.log(`     Symbol: "${jsonMetadata.symbol}"`);
      console.log(`     Image: "${jsonMetadata.image}"`);
      if (jsonMetadata.description) {
        console.log(`     Description: "${jsonMetadata.description.slice(0, 100)}..."`);
      }
    }
  }

  console.log('\n=============================================');
  console.log('📊 FINAL RESULT');
  console.log('=============================================\n');
  
  // Fetch JSON for final result
  const jsonMeta = metadata.uri ? await fetchJsonMetadata(metadata.uri) : null;
  
  console.log(`Name: ${jsonMeta?.name || metadata.name}`);
  console.log(`Symbol: ${jsonMeta?.symbol || metadata.symbol}`);
  console.log(`Image: ${jsonMeta?.image || 'N/A'}`);
  console.log(`URI: ${metadata.uri}`);
}

main().catch(console.error);