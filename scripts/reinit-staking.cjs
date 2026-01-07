const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@coral-xyz/anchor');
const fs = require('fs');
const BN = require('bn.js');

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

// Load your wallet keypair
const secretKey = JSON.parse(fs.readFileSync('../keys/admin.json', 'utf8'));
const wallet = new Wallet(Keypair.fromSecretKey(new Uint8Array(secretKey)));

// Load IDL
const idl = JSON.parse(fs.readFileSync('../target/idl/memecoin_lending.json', 'utf8'));

const PROGRAM_ID = new PublicKey('CD2sN1enC22Nyw6U6s2dYcxfbtsLVq2PhbomLBkyh1z5');
const STAKING_TOKEN_MINT = new PublicKey('6KHL8uUXFie8Xdy3EBvw6EgruiU3duc9fvGrWoZ9pump');

(async () => {
  try {
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl, PROGRAM_ID, provider);
    
    console.log('🔄 Trying to update staking config to reset corrupted values...');
    
    // Try to update config instead of reinitialize
    const signature = await program.methods
      .updateStakingConfig(
        null, // targetPoolBalance - keep existing
        new BN(100 * 1e9), // baseEmissionRate - 100 SOL/sec
        new BN(200 * 1e9), // maxEmissionRate - 200 SOL/sec  
        new BN(50 * 1e9),  // minEmissionRate - 50 SOL/sec
        false // paused
      )
      .accounts({
        stakingPool: PublicKey.findProgramAddressSync([Buffer.from('staking_pool')], PROGRAM_ID)[0],
        authority: wallet.publicKey,
      })
      .rpc();
      
    console.log('✅ Staking config updated:', signature);
    
  } catch (error) {
    console.error('❌ Error updating config:', error);
    console.log('\\n🔧 The staking pool data appears corrupted.');
    console.log('This likely requires a program redeployment or manual account reset.');
  }
})();