import { Connection, PublicKey } from '@solana/web3.js';

const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface TokenMetadataResult {
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  uri?: string;
}

/**
 * Derive the Metaplex metadata PDA for a token mint
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
 * Parse a string from Metaplex metadata buffer (4-byte length prefix)
 */
function parseMetaplexString(buffer: Buffer, offset: number): { value: string; newOffset: number } {
  const length = buffer.readUInt32LE(offset);
  const value = buffer.slice(offset + 4, offset + 4 + length).toString('utf8').replace(/\0/g, '').trim();
  return { value, newOffset: offset + 4 + length };
}

/**
 * Parse Metaplex Token Metadata from on-chain account data
 */
function parseMetaplexMetadata(data: Buffer): { name: string; symbol: string; uri: string } | null {
  try {
    // Skip: key (1) + update_authority (32) + mint (32) = 65 bytes
    let offset = 1 + 32 + 32;

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
    console.error('[TokenMetadata] Failed to parse Metaplex data:', error);
    return null;
  }
}

/**
 * Convert IPFS/Arweave URIs to HTTP gateway URLs
 */
function toHttpUrl(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    return uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }
  if (uri.startsWith('ar://')) {
    return uri.replace('ar://', 'https://arweave.net/');
  }
  return uri;
}

/**
 * Fetch JSON metadata from URI (IPFS, Arweave, HTTP)
 */
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
    console.warn(`[TokenMetadata] Failed to fetch JSON from ${uri}:`, error);
    return null;
  }
}

/**
 * Fetch token metadata from on-chain Metaplex Token Metadata
 */
export async function fetchTokenMetadata(
  mint: string, 
  connection: Connection
): Promise<TokenMetadataResult | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const metadataPDA = getMetadataPDA(mintPubkey);
    
    // Fetch on-chain metadata account
    const accountInfo = await connection.getAccountInfo(metadataPDA);
    if (!accountInfo) {
      console.warn(`[TokenMetadata] No metadata account for ${mint.slice(0, 8)}...`);
      return null;
    }

    // Parse on-chain data
    const onChainMeta = parseMetaplexMetadata(accountInfo.data);
    if (!onChainMeta) {
      return null;
    }

    console.log(`[TokenMetadata] Found ${mint.slice(0, 8)}...: ${onChainMeta.symbol} - ${onChainMeta.name}`);

    // Fetch JSON from URI to get image
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
    console.error(`[TokenMetadata] Error fetching metadata for ${mint}:`, error);
    return null;
  }
}

/**
 * Batch fetch metadata for multiple tokens
 */
export async function fetchTokenMetadataBatch(
  mints: string[],
  connection: Connection
): Promise<Map<string, TokenMetadataResult>> {
  const results = new Map<string, TokenMetadataResult>();
  
  // Fetch in parallel with concurrency limit
  const BATCH_SIZE = 5;
  for (let i = 0; i < mints.length; i += BATCH_SIZE) {
    const batch = mints.slice(i, i + BATCH_SIZE);
    const promises = batch.map(mint => 
      fetchTokenMetadata(mint, connection).then(result => ({ mint, result }))
    );
    
    const batchResults = await Promise.all(promises);
    for (const { mint, result } of batchResults) {
      if (result) {
        results.set(mint, result);
      }
    }
  }
  
  return results;
}