#!/usr/bin/env npx tsx
/**
 * Update Token Pool Address
 * 
 * Updates the pool_address in an existing on-chain token_config.
 * 
 * Usage: npx tsx scripts/update-token-pool.ts --mint <token> --pool <pool> --network mainnet
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Command } from 'commander';

dotenv.config();

const program = new Command();

program
  .requiredOption('--mint <address>', 'Token mint address')
  .requiredOption('--pool <address>', 'New pool address')
  .option('--network <network>', 'Network (mainnet/devnet)', 'mainnet')
  .option('--keypair <path>', 'Admin keypair path', './keys/admin.json')
  .option('--program-id <address>', 'Program ID (overrides IDL)')
  .option('--dry-run', 'Simulate without executing')
  .parse();

const opts = program.opts();

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL or RPC_URL not set in .env');
  
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load admin keypair
  const keypairPath = opts.keypair;
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Admin keypair not found at ${keypairPath}`);
  }
  
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')))
  );
  
  console.log('\n🔧 Update Token Pool Address');
  console.log('═'.repeat(50));
  console.log(`  Mint:     ${opts.mint}`);
  console.log(`  New Pool: ${opts.pool}`);
  console.log(`  Admin:    ${adminKeypair.publicKey.toString()}`);
  console.log(`  Network:  ${opts.network}`);
  console.log(`  RPC:      ${rpcUrl.substring(0, 40)}...`);
  console.log('═'.repeat(50));
  
  // Load IDL
  const idlPath = './target/idl/memecoin_lending.json';
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run 'anchor build' first.`);
  }
  
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  
  // Use provided program ID, or fall back to env, or IDL
  const programId = opts.programId 
    ? new PublicKey(opts.programId)
    : new PublicKey(process.env.PROGRAM_ID || idl.address);
  
  console.log(`\n  Program ID: ${programId.toString()}`);
  
  const provider = new AnchorProvider(
    connection,
    new Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );
  
  const programClient = new Program(idl, provider);
  
  // Derive PDAs
  const [protocolState] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_state')],
    programId
  );
  
  const mintPubkey = new PublicKey(opts.mint);
  const [tokenConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), mintPubkey.toBuffer()],
    programId
  );
  
  console.log(`  Protocol State: ${protocolState.toString()}`);
  console.log(`  Token Config:   ${tokenConfig.toString()}`);
  
  // Fetch current token config
  let currentConfig: any;
  try {
    currentConfig = await (programClient.account as any).tokenConfig.fetch(tokenConfig);
  } catch (e) {
    throw new Error(`Token config not found for ${opts.mint}. Is it whitelisted?`);
  }
  
  console.log(`\n📋 Current Configuration:`);
  console.log(`  Pool Address: ${currentConfig.poolAddress.toString()}`);
  console.log(`  Pool Type:    ${JSON.stringify(currentConfig.poolType)}`);
  console.log(`  Enabled:      ${currentConfig.enabled}`);
  console.log(`  LTV BPS:      ${currentConfig.ltvBps}`);
  
  const newPoolPubkey = new PublicKey(opts.pool);
  
  if (currentConfig.poolAddress.equals(newPoolPubkey)) {
    console.log('\n✅ Pool address already matches. No update needed.');
    return;
  }
  
  if (opts.dryRun) {
    console.log('\n🔍 [DRY RUN] Would execute update_token_config with:');
    console.log(`  pool_address: ${opts.pool}`);
    console.log('\nNo changes made.');
    return;
  }
  
  console.log(`\n🚀 Updating pool address...`);
  
  // Execute update
  try {
    const tx = await (programClient.methods as any)
      .updateTokenConfig(
        null,  // enabled - no change
        null,  // ltv_bps - no change
        newPoolPubkey,  // pool_address - UPDATE THIS
        null,  // pool_type - no change
      )
      .accounts({
        protocolState,
        tokenConfig,
        admin: adminKeypair.publicKey,
      })
      .rpc();
    
    console.log(`\n✅ Updated successfully!`);
    console.log(`  Transaction: ${tx}`);
    console.log(`  Explorer: https://solscan.io/tx/${tx}`);
    
    // Verify
    const updatedConfig = await (programClient.account as any).tokenConfig.fetch(tokenConfig);
    console.log(`\n📋 New Configuration:`);
    console.log(`  Pool Address: ${updatedConfig.poolAddress.toString()}`);
    
    if (updatedConfig.poolAddress.equals(newPoolPubkey)) {
      console.log('\n✅ Verification passed - pool address updated correctly!');
    } else {
      console.log('\n⚠️  Warning: Pool address may not have updated correctly');
    }
    
  } catch (e: any) {
    console.error('\n❌ Update failed:', e.message);
    if (e.logs) {
      console.error('\nProgram logs:');
      e.logs.forEach((log: string) => console.error('  ', log));
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});