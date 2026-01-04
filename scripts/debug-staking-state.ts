#!/usr/bin/env tsx

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = 'DWPzC5B8wCYFJFw9khPiCwSvErNJTVaBxpUzrxbTCNJk';

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  
  // Derive staking pool PDA
  const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    new PublicKey(PROGRAM_ID)
  );
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STAKING POOL DEBUG REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n📍 Program ID:', PROGRAM_ID);
  console.log('📍 Staking Pool PDA:', stakingPoolPDA.toString());
  
  const accountInfo = await connection.getAccountInfo(stakingPoolPDA);
  
  if (!accountInfo) {
    console.log('\n❌ STAKING POOL NOT FOUND!');
    console.log('   The staking pool has not been initialized for this program.');
    return;
  }
  
  console.log('\n📦 Account Info:');
  console.log('   Owner:', accountInfo.owner.toString());
  console.log('   Data Size:', accountInfo.data.length, 'bytes');
  console.log('   Lamports:', accountInfo.lamports, `(${accountInfo.lamports / LAMPORTS_PER_SOL} SOL)`);
  
  // Show raw hex for first 300 bytes
  console.log('\n🔍 Raw Data (first 300 bytes hex):');
  const hexData = accountInfo.data.slice(0, 300).toString('hex');
  // Format in 64-char lines
  for (let i = 0; i < hexData.length; i += 64) {
    console.log('   ', hexData.slice(i, i + 64));
  }
  
  const data = accountInfo.data;
  
  // Parse discriminator
  const discriminator = data.slice(0, 8).toString('hex');
  console.log('\n📋 Discriminator:', discriminator);
  
  let offset = 8;
  
  // Parse with EXPECTED new layout (direct distribution)
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PARSING WITH NEW LAYOUT (Direct Distribution)');
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
    const authority = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const mint = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const stakingVault = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const rewardVault = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    
    console.log('\n🔑 Addresses:');
    console.log('   Authority:', authority.toString());
    console.log('   Token Mint:', mint.toString());
    console.log('   Staking Vault:', stakingVault.toString());
    console.log('   Reward Vault:', rewardVault.toString());
    
    // Epoch fields
    const currentEpoch = data.readBigUInt64LE(offset); offset += 8;
    const epochDuration = data.readBigInt64LE(offset); offset += 8;
    const epochStartTime = data.readBigInt64LE(offset); offset += 8;
    const totalStaked = data.readBigUInt64LE(offset); offset += 8;
    const currentEpochEligibleStake = data.readBigUInt64LE(offset); offset += 8;
    const currentEpochRewards = data.readBigUInt64LE(offset); offset += 8;
    const lastEpochRewards = data.readBigUInt64LE(offset); offset += 8;
    const lastEpochEligibleStake = data.readBigUInt64LE(offset); offset += 8;
    const lastEpochDistributed = data.readBigUInt64LE(offset); offset += 8;
    const totalRewardsDistributed = data.readBigUInt64LE(offset); offset += 8;
    const totalRewardsDeposited = data.readBigUInt64LE(offset); offset += 8;
    const totalEpochsCompleted = data.readBigUInt64LE(offset); offset += 8;
    const paused = data[offset] === 1; offset += 1;
    const bump = data[offset]; offset += 1;
    
    console.log('\n📊 Epoch State:');
    console.log('   Current Epoch:', currentEpoch.toString());
    console.log('   Epoch Duration:', epochDuration.toString(), 'seconds');
    const startDate = new Date(Number(epochStartTime) * 1000);
    console.log('   Epoch Start Time:', epochStartTime.toString(), `(${startDate.toISOString()})`);
    
    // Calculate time until next epoch
    const now = Math.floor(Date.now() / 1000);
    const epochEndTime = Number(epochStartTime) + Number(epochDuration);
    const timeUntilNext = epochEndTime - now;
    console.log('   Time Until Next Epoch:', timeUntilNext, 'seconds', `(${Math.floor(timeUntilNext / 60)} minutes)`);
    
    console.log('\n💰 Staking State:');
    console.log('   Total Staked:', totalStaked.toString());
    console.log('   Current Epoch Eligible Stake:', currentEpochEligibleStake.toString());
    console.log('   Current Epoch Rewards:', currentEpochRewards.toString());
    
    console.log('\n📦 Last Epoch (Distribution):');
    console.log('   Last Epoch Rewards:', lastEpochRewards.toString());
    console.log('   Last Epoch Eligible Stake:', lastEpochEligibleStake.toString());
    console.log('   Last Epoch Distributed:', lastEpochDistributed.toString());
    
    console.log('\n📈 Stats:');
    console.log('   Total Rewards Distributed:', totalRewardsDistributed.toString());
    console.log('   Total Rewards Deposited:', totalRewardsDeposited.toString());
    console.log('   Total Epochs Completed:', totalEpochsCompleted.toString());
    
    console.log('\n⚙️ Settings:');
    console.log('   Paused:', paused);
    console.log('   Bump:', bump);
    
    // Sanity checks
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SANITY CHECKS');
    console.log('═══════════════════════════════════════════════════════════');
    
    const issues: string[] = [];
    
    if (Number(currentEpoch) > 1000) {
      issues.push(`❌ Current epoch (${currentEpoch}) is impossibly high - likely parsing error`);
    } else {
      console.log('✅ Current epoch looks reasonable:', currentEpoch.toString());
    }
    
    if (Number(epochDuration) < 60 || Number(epochDuration) > 604800) {
      issues.push(`❌ Epoch duration (${epochDuration}s) is outside valid range (60s - 1 week)`);
    } else {
      console.log('✅ Epoch duration looks reasonable:', epochDuration.toString(), 'seconds');
    }
    
    if (Number(epochStartTime) < 1700000000 || Number(epochStartTime) > 2000000000) {
      issues.push(`❌ Epoch start time (${epochStartTime}) doesn't look like a valid timestamp`);
    } else {
      console.log('✅ Epoch start time looks reasonable:', startDate.toISOString());
    }
    
    if (issues.length > 0) {
      console.log('\n🚨 ISSUES FOUND:');
      issues.forEach(issue => console.log('  ', issue));
      console.log('\n💡 This likely means:');
      console.log('   1. The on-chain struct layout doesn\'t match the parsing code');
      console.log('   2. Or this is OLD data from a previous program deployment');
    } else {
      console.log('\n✅ All sanity checks passed!');
    }
    
  } catch (error: any) {
    console.log('\n❌ Parsing error:', error.message);
  }
  
  // Also check reward vault balance
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  REWARD VAULT CHECK');
  console.log('═══════════════════════════════════════════════════════════');
  
  const [rewardVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('reward_vault')],
    new PublicKey(PROGRAM_ID)
  );
  
  const vaultBalance = await connection.getBalance(rewardVaultPDA);
  console.log('   Reward Vault PDA:', rewardVaultPDA.toString());
  console.log('   Balance:', vaultBalance, 'lamports', `(${vaultBalance / LAMPORTS_PER_SOL} SOL)`);
}

main().catch(console.error);