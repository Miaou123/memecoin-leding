import { Connection } from '@solana/web3.js';
import { getNetworkConfig, NetworkType } from '@memecoin-lending/config';
import { prisma } from '../src/db/client.js';
import { fetchTokenMetadata } from '../src/services/token-metadata.service.js';

/**
 * Refresh metadata for all tokens in the database using on-chain Metaplex metadata
 */
async function refreshTokenMetadata() {
  try {
    console.log('[RefreshMetadata] Starting metadata refresh...');
    
    const network = (process.env.SOLANA_NETWORK as NetworkType) || 'devnet';
    const networkConfig = getNetworkConfig(network);
    const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
    
    // Get all enabled tokens from database
    const tokens = await prisma.token.findMany({
      where: { enabled: true },
      select: { id: true, symbol: true, name: true, imageUrl: true },
    });
    
    console.log(`[RefreshMetadata] Found ${tokens.length} enabled tokens`);
    
    let updated = 0;
    let errors = 0;
    
    // Process tokens in batches to avoid rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      
      console.log(`[RefreshMetadata] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tokens.length / BATCH_SIZE)}...`);
      
      const promises = batch.map(async (token) => {
        try {
          const metadata = await fetchTokenMetadata(token.id, connection);
          
          if (metadata) {
            // Only update if metadata was found and is different
            const hasChanges = 
              metadata.symbol !== token.symbol ||
              metadata.name !== token.name ||
              metadata.image !== token.imageUrl;
            
            if (hasChanges) {
              await prisma.token.update({
                where: { id: token.id },
                data: {
                  symbol: metadata.symbol || token.symbol,
                  name: metadata.name || token.name,
                  imageUrl: metadata.image,
                },
              });
              
              console.log(`[RefreshMetadata] Updated ${token.id.slice(0, 8)}...: ${metadata.symbol} - ${metadata.name}${metadata.image ? ' (with image)' : ''}`);
              return true;
            } else {
              console.log(`[RefreshMetadata] No changes for ${token.id.slice(0, 8)}...: ${token.symbol}`);
              return false;
            }
          } else {
            console.log(`[RefreshMetadata] No metadata found for ${token.id.slice(0, 8)}...: ${token.symbol}`);
            return false;
          }
        } catch (error) {
          console.error(`[RefreshMetadata] Error updating ${token.id.slice(0, 8)}...:`, error);
          return null;
        }
      });
      
      const results = await Promise.all(promises);
      
      // Count results
      for (const result of results) {
        if (result === true) updated++;
        else if (result === null) errors++;
      }
      
      // Add delay between batches to be respectful to RPC
      if (i + BATCH_SIZE < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`[RefreshMetadata] Complete! Updated: ${updated}, Errors: ${errors}, Total processed: ${tokens.length}`);
    
    // Display sample of updated tokens
    const sampleTokens = await prisma.token.findMany({
      where: { 
        enabled: true,
        imageUrl: { not: null },
      },
      select: { 
        id: true, 
        symbol: true, 
        name: true, 
        imageUrl: true 
      },
      take: 5,
    });
    
    if (sampleTokens.length > 0) {
      console.log('\n[RefreshMetadata] Sample tokens with metadata:');
      for (const token of sampleTokens) {
        console.log(`  ${token.symbol} (${token.name}) - ${token.imageUrl ? '✓ Has image' : '✗ No image'}`);
      }
    }
    
  } catch (error) {
    console.error('[RefreshMetadata] Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

refreshTokenMetadata();