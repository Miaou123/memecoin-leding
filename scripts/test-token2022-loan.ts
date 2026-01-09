import { getProgram, getConnection } from '../apps/server/src/services/solana.service.js';
import { PublicKey } from '@solana/web3.js';

// Replace with your actual token mint that's having issues
const TOKEN_2022_MINT = process.argv[2] || 'YOUR_TOKEN_MINT_HERE';

async function testToken2022() {
  console.log('Testing Token-2022 token:', TOKEN_2022_MINT);
  
  const connection = getConnection();
  const program = getProgram();
  
  try {
    // Check if mint exists
    const mintInfo = await connection.getAccountInfo(new PublicKey(TOKEN_2022_MINT));
    if (!mintInfo) {
      console.log('❌ Mint account not found');
      return;
    }
    
    console.log('✅ Mint found');
    console.log('Owner program:', mintInfo.owner.toString());
    
    const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const isToken2022 = mintInfo.owner.toString() === TOKEN_2022_PROGRAM;
    console.log('Is Token-2022:', isToken2022);
    
    // Check if token config exists
    const TOKEN_CONFIG_SEED = Buffer.from('token_config');
    const tokenMint = new PublicKey(TOKEN_2022_MINT);
    const [tokenConfigPda] = PublicKey.findProgramAddressSync(
      [TOKEN_CONFIG_SEED, tokenMint.toBuffer()],
      program.programId
    );
    
    console.log('\nChecking token config PDA:', tokenConfigPda.toString());
    
    try {
      const tokenConfig = await (program.account as any).tokenConfig.fetch(tokenConfigPda);
      console.log('✅ Token config found');
      console.log('Pool address:', tokenConfig.poolAddress.toString());
      console.log('Pool type:', JSON.stringify(tokenConfig.poolType));
      console.log('Enabled:', tokenConfig.enabled);
      console.log('LTV BPS:', tokenConfig.ltvBps);
      console.log('Tier:', tokenConfig.tier);
      
      // Check if it's PumpSwap
      let isPumpSwap = false;
      if (typeof tokenConfig.poolType === 'object' && tokenConfig.poolType !== null) {
        const poolTypeKey = Object.keys(tokenConfig.poolType)[0];
        isPumpSwap = poolTypeKey === 'pumpSwap';
        console.log('Pool type key:', poolTypeKey, 'isPumpSwap:', isPumpSwap);
      }
    } catch (error: any) {
      console.log('❌ Token config not found:', error.message);
      console.log('\nThis token needs to be whitelisted first!');
    }
    
    // Check Jupiter price
    console.log('\nChecking Jupiter price...');
    try {
      const JUPITER_API = 'https://api.jup.ag/price/v3';
      const response = await fetch(`${JUPITER_API}?ids=${TOKEN_2022_MINT}`);
      const data = await response.json();
      
      if (data[TOKEN_2022_MINT]) {
        console.log('✅ Jupiter has price data');
        console.log('USD Price:', data[TOKEN_2022_MINT].usdPrice);
      } else {
        console.log('❌ Jupiter does not have price data for this token');
      }
    } catch (error) {
      console.log('❌ Failed to check Jupiter price:', error);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testToken2022().catch(console.error);