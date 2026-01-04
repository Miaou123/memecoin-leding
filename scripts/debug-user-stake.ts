import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = 'DWPzC5B8wCYFJFw9khPiCwSvErNJTVaBxpUzrxbTCNJk';

async function main() {
  const userWallet = process.argv[2] || 'BaSDRWLRmTenTXBKAAJu3ehoiKHa5juCayYkMkCeCQx5';
  
  const connection = new Connection(RPC, 'confirmed');
  const programId = new PublicKey(PROGRAM_ID);
  
  const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );
  
  const [userStakePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPoolPDA.toBuffer(), new PublicKey(userWallet).toBuffer()],
    programId
  );
  
  console.log('User Wallet:', userWallet);
  console.log('User Stake PDA:', userStakePDA.toString());
  
  const accountInfo = await connection.getAccountInfo(userStakePDA);
  
  if (!accountInfo) {
    console.log('❌ User stake account not found!');
    return;
  }
  
  console.log('Account size:', accountInfo.data.length, 'bytes');
  
  const data = accountInfo.data;
  let offset = 8; // Skip discriminator
  
  const owner = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const pool = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const stakedAmount = data.readBigUInt64LE(offset); offset += 8;
  const stakeStartEpoch = data.readBigUInt64LE(offset); offset += 8;
  const lastRewardedEpoch = data.readBigUInt64LE(offset); offset += 8;
  const totalRewardsReceived = data.readBigUInt64LE(offset); offset += 8;
  
  console.log('\n📊 User Stake State:');
  console.log('   Owner:', owner.toString());
  console.log('   Staked Amount:', stakedAmount.toString(), `(${Number(stakedAmount) / 1e6} tokens)`);
  console.log('   Stake Start Epoch:', stakeStartEpoch.toString());
  console.log('   Last Rewarded Epoch:', lastRewardedEpoch.toString());
  console.log('   Total Rewards Received:', totalRewardsReceived.toString(), `(${Number(totalRewardsReceived) / 1e9} SOL)`);
  
  // Eligibility check
  const currentEpoch = 26n;
  const lastEpoch = currentEpoch - 1n;
  
  console.log('\n🔍 Eligibility Check:');
  console.log('   Current Epoch:', currentEpoch.toString());
  console.log('   Last Epoch (to distribute):', lastEpoch.toString());
  console.log('   Stake Start Epoch:', stakeStartEpoch.toString());
  console.log('   Last Rewarded Epoch:', lastRewardedEpoch.toString());
  
  const wasStakedBeforeEpoch = stakeStartEpoch < lastEpoch;
  const notYetRewarded = lastRewardedEpoch < lastEpoch;
  
  console.log('\n   Was staked before epoch 25?', wasStakedBeforeEpoch ? '✅ YES' : '❌ NO');
  console.log('   Not yet rewarded for epoch 25?', notYetRewarded ? '✅ YES' : '❌ NO');
  console.log('   ELIGIBLE?', (wasStakedBeforeEpoch && notYetRewarded) ? '✅ YES' : '❌ NO');
}

main().catch(console.error);
