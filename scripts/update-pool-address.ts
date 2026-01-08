import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

async function main() {
  // Configuration
  const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load admin keypair
  const adminKeyPath = path.join(process.cwd(), 'keys', 'admin.json');
  if (!fs.existsSync(adminKeyPath)) {
    throw new Error(`Admin key not found at ${adminKeyPath}`);
  }
  
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminKeyPath, 'utf-8')))
  );
  
  console.log('Admin pubkey:', adminKeypair.publicKey.toString());
  
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed'
  });
  
  // Load IDL
  const idlPath = path.join(process.cwd(), 'target', 'idl', 'memecoin_lending.json');
  const idl: Idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const programId = new PublicKey('2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S');
  const program = new Program(idl, provider);
  
  // Token configuration
  const tokenMint = new PublicKey('a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump');
  const correctPoolAddress = new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ');
  
  // Derive PDAs
  const [protocolStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_state')],
    programId
  );
  
  const [tokenConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    programId
  );
  
  console.log('\n=== Updating Token Config ===');
  console.log('Token mint:', tokenMint.toString());
  console.log('Token config PDA:', tokenConfigPda.toString());
  console.log('New pool address:', correctPoolAddress.toString());
  
  // Fetch current config
  const currentConfig = await program.account.tokenConfig.fetch(tokenConfigPda);
  console.log('\nCurrent pool address:', currentConfig.poolAddress.toString());
  console.log('Current pool type:', currentConfig.poolType);
  
  try {
    console.log('\nSending update transaction...');
    const tx = await program.methods
      .updateTokenConfig(
        null,  // enabled - no change
        null,  // ltv_bps - no change
        correctPoolAddress,  // pool_address - UPDATE THIS
        null   // pool_type - no change (already pumpSwap)
      )
      .accounts({
        protocolState: protocolStatePda,
        tokenConfig: tokenConfigPda,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();
    
    console.log('\n✅ Transaction successful!');
    console.log('Transaction signature:', tx);
    console.log('Explorer link:', `https://solscan.io/tx/${tx}`);
    
    // Wait a moment for the transaction to be confirmed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify the update
    console.log('\n=== Verifying Update ===');
    const updatedConfig = await program.account.tokenConfig.fetch(tokenConfigPda);
    console.log('Updated pool address:', updatedConfig.poolAddress.toString());
    console.log('Pool address matches expected:', updatedConfig.poolAddress.equals(correctPoolAddress) ? '✅ YES' : '❌ NO');
    
    // Verify pool account exists
    const poolAccount = await connection.getAccountInfo(updatedConfig.poolAddress);
    if (poolAccount) {
      console.log('\nPool account info:');
      console.log('- Exists: ✅ YES');
      console.log('- Size:', poolAccount.data.length, 'bytes');
      console.log('- Owner:', poolAccount.owner.toString());
    } else {
      console.log('\n❌ Pool account does not exist!');
    }
    
  } catch (error) {
    console.error('\n❌ Error updating token config:', error);
    if (error instanceof Error && 'logs' in error) {
      console.error('Program logs:', (error as any).logs);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});