#!/usr/bin/env tsx

/**
 * Update Token Metadata
 * 
 * Fetches and updates metadata for all tokens in the database
 * - Fetches from Metaplex Token Metadata program
 * - Falls back to DexScreener for tokens without Metaplex metadata
 * 
 * Usage: npx tsx scripts/update-token-metadata.ts
 */

import { PrismaClient } from '../apps/server/node_modules/@prisma/client/index.js';
import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

interface TokenMetadataResult {
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  uri?: string;
}

interface DexScreenerToken {
  address: string;
  name: string;
  symbol: string;
}

interface DexScreenerPair {
  baseToken: DexScreenerToken;
  liquidity?: {
    usd?: number;
  };
}

interface DexScreenerResponse {
  pairs?: DexScreenerPair[];
}

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

function parseMetaplexString(buffer: Buffer, offset: number): { value: string; newOffset: number } {
  const length = buffer.readUInt32LE(offset);
  const value = buffer.slice(offset + 4, offset + 4 + length).toString('utf8').replace(/\0/g, '').trim();
  return { value, newOffset: offset + 4 + length };
}

function parseMetaplexMetadata(data: Buffer): { name: string; symbol: string; uri: string } | null {
  try {
    let offset = 1 + 32 + 32; // Skip: key (1) + update_authority (32) + mint (32)
    const nameResult = parseMetaplexString(data, offset);
    offset = nameResult.newOffset;
    const symbolResult = parseMetaplexString(data, offset);
    offset = symbolResult.newOffset;
    const uriResult = parseMetaplexString(data, offset);
    return {
      name: nameResult.value,
      symbol: symbolResult.value,
      uri: uriResult.value,
    };
  } catch (error) {
    console.error('Failed to parse Metaplex data:', error);
    return null;
  }
}

function toHttpUrl(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    return uri.replace('ipfs://', 'https://dweb.link/ipfs/');
  }
  if (uri.startsWith('https://ipfs.io/ipfs/')) {
    return uri.replace('https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/');
  }
  if (uri.startsWith('ar://')) {
    return uri.replace('ar://', 'https://arweave.net/');
  }
  return uri;
}

async function fetchJsonMetadata(uri: string): Promise<{ image?: string; description?: string } | null> {
  try {
    const fetchUrl = toHttpUrl(uri);
    const response = await fetch(fetchUrl, { 
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const json = await response.json() as any;
    return {
      image: json.image ? toHttpUrl(json.image) : undefined,
      description: json.description,
    };
  } catch (error) {
    console.warn(`Failed to fetch JSON from ${uri}:`, error);
    return null;
  }
}

async function fetchTokenMetadata(mint: string, connection: Connection): Promise<TokenMetadataResult | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const metadataPDA = getMetadataPDA(mintPubkey);
    const accountInfo = await connection.getAccountInfo(metadataPDA);
    
    if (!accountInfo) {
      console.log(chalk.yellow(`No Metaplex metadata for ${mint.slice(0, 8)}...`));
      return null;
    }

    const onChainMeta = parseMetaplexMetadata(accountInfo.data);
    if (!onChainMeta) return null;

    let image: string | undefined;
    let description: string | undefined;
    
    if (onChainMeta.uri) {
      const jsonMeta = await fetchJsonMetadata(onChainMeta.uri);
      if (jsonMeta) {
        image = jsonMeta.image;
        description = jsonMeta.description;
      }
    }

    return {
      name: onChainMeta.name,
      symbol: onChainMeta.symbol,
      image,
      description,
      uri: onChainMeta.uri,
    };
  } catch (error) {
    console.error(`Error fetching metadata for ${mint}:`, error);
    return null;
  }
}

async function fetchDexScreenerMetadata(mint: string): Promise<{ name: string; symbol: string } | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return null;

    const data = await response.json() as DexScreenerResponse;
    
    if (data.pairs && data.pairs.length > 0) {
      // Find the pair with highest liquidity
      const bestPair = data.pairs.reduce((best, pair) => {
        const currentLiquidity = pair.liquidity?.usd || 0;
        const bestLiquidity = best.liquidity?.usd || 0;
        return currentLiquidity > bestLiquidity ? pair : best;
      }, data.pairs[0]);

      if (bestPair?.baseToken) {
        return {
          name: bestPair.baseToken.name,
          symbol: bestPair.baseToken.symbol,
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`Error fetching DexScreener data for ${mint}:`, error);
    return null;
  }
}

async function main() {
  console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════'));
  console.log(chalk.blue.bold('  📝 Update Token Metadata'));
  console.log(chalk.blue.bold('════════════════════════════════════════════════════════════\n'));

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );

  try {
    // Get all tokens from database
    const tokens = await prisma.token.findMany({
      orderBy: { createdAt: 'desc' },
    });

    console.log(chalk.gray(`Found ${tokens.length} tokens in database\n`));

    let updated = 0;
    let failed = 0;

    for (const token of tokens) {
      console.log(chalk.gray(`Processing ${token.id.slice(0, 8)}... (${token.symbol || 'UNKNOWN'})`));

      try {
        // First try Metaplex metadata
        let metadata = await fetchTokenMetadata(token.id, connection);
        let source = 'Metaplex';

        // If no Metaplex metadata, try DexScreener
        if (!metadata) {
          const dexData = await fetchDexScreenerMetadata(token.id);
          if (dexData) {
            metadata = {
              name: dexData.name,
              symbol: dexData.symbol,
            };
            source = 'DexScreener';
          }
        }

        if (metadata) {
          // Check if update is needed
          const needsUpdate = 
            token.symbol !== metadata.symbol ||
            token.name !== metadata.name ||
            (metadata.image && token.imageUrl !== metadata.image);

          if (needsUpdate) {
            await prisma.token.update({
              where: { id: token.id },
              data: {
                symbol: metadata.symbol,
                name: metadata.name,
                imageUrl: metadata.image || token.imageUrl,
              },
            });

            console.log(chalk.green(`✅ Updated from ${source}:`));
            console.log(chalk.gray(`   ${token.symbol || 'PUMP'} → ${metadata.symbol}`));
            console.log(chalk.gray(`   ${token.name || 'PumpFun Token'} → ${metadata.name}`));
            if (metadata.image && !token.imageUrl) {
              console.log(chalk.gray(`   Added image URL`));
            }
            updated++;
          } else {
            console.log(chalk.blue(`✓ Already up to date`));
          }
        } else {
          console.log(chalk.yellow(`⚠️ No metadata found - keeping existing values`));
        }
      } catch (error: any) {
        console.log(chalk.red(`❌ Failed: ${error.message}`));
        failed++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(chalk.green.bold(`\n✅ Summary:`));
    console.log(chalk.gray(`   Updated: ${updated} tokens`));
    console.log(chalk.gray(`   Failed: ${failed} tokens`));
    console.log(chalk.gray(`   Total: ${tokens.length} tokens`));

  } catch (error: any) {
    console.error(chalk.red('❌ Error:'), error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);