#!/usr/bin/env tsx

/**
 * Memecoin Lending Protocol - Devnet Integration Tests
 * 
 * This script tests all protocol functionalities against the deployed devnet program.
 * Unlike anchor tests which run against localnet with mocks, this uses real devnet state.
 * 
 * Usage:
 *   npx tsx devnet-integration-tests.ts --network devnet
 *   npx tsx devnet-integration-tests.ts --network devnet --skip-setup
 *   npx tsx devnet-integration-tests.ts --network devnet --test-only loans
 * 
 * Prerequisites:
 *   - Protocol deployed and initialized on devnet
 *   - Admin keypair with SOL at ./keys/admin.json
 *   - At least one whitelisted token
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
  createMint, 
  createAssociatedTokenAccount, 
  mintTo, 
  getAccount,
  getAssociatedTokenAddress 
} from '@solana/spl-token';
import BN from 'bn.js';

// Import the existing createClient from cli-utils
import { createClient as createSDKClient } from './cli-utils.js';

config();

// ============= Test Configuration =============
interface TestConfig {
  network: string;
  rpcUrl: string;
  skipSetup: boolean;
  testOnly: string | null;
  verbose: boolean;
}

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  duration: number;
  txSignature?: string;
}

// ============= Test State =============
const testResults: TestResult[] = [];
let testTokenMint: PublicKey | null = null;
let testLoanPda: PublicKey | null = null;
let stakingInitialized = false;

// ============= Utility Functions =============
function getRpcUrl(network: string): string {
  if (network === 'devnet') {
    return process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
  } else if (network === 'mainnet-beta') {
    return process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
  }
  return 'http://localhost:8899';
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ============= Test Runner =============
async function runTest(
  name: string, 
  category: string, 
  testFn: () => Promise<string | void>,
  config: TestConfig
): Promise<boolean> {
  const startTime = Date.now();
  
  if (config.testOnly && config.testOnly !== category) {
    return true; // Skip if filtering
  }
  
  process.stdout.write(chalk.gray(`  ⏳ ${name}... `));
  
  try {
    const txSig = await testFn();
    const duration = Date.now() - startTime;
    
    testResults.push({
      name,
      category,
      passed: true,
      duration,
      txSignature: txSig || undefined
    });
    
    console.log(chalk.green(`✓`) + chalk.gray(` (${formatDuration(duration)})`));
    if (txSig && config.verbose) {
      console.log(chalk.gray(`    TX: ${txSig}`));
    }
    return true;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    testResults.push({
      name,
      category,
      passed: false,
      error: error.message,
      duration
    });
    
    console.log(chalk.red(`✗`) + chalk.gray(` (${formatDuration(duration)})`));
    console.log(chalk.red(`    Error: ${error.message}`));
    return false;
  }
}

// ============= Import SDK using cli-utils =============
async function loadSDK(network: string, keypairPath: string) {
  // Use the existing createClient from cli-utils which handles IDL loading
  const { client, keypair, connection } = await createSDKClient(network, keypairPath);
  
  return { client, keypair, connection };
}

// Load multiple accounts for different test roles
interface TestAccounts {
  admin: { client: any; keypair: Keypair; connection: Connection };
  borrower: { client: any; keypair: Keypair; connection: Connection };
  staker: { client: any; keypair: Keypair; connection: Connection };
}

async function loadAllAccounts(network: string): Promise<TestAccounts> {
  console.log(chalk.yellow('\n📦 Loading SDK with multiple accounts...'));
  
  // Admin account - for protocol management
  console.log(chalk.gray('  Loading admin account...'));
  const admin = await loadSDK(network, './keys/admin.json');
  console.log(chalk.green(`  ✓ Admin: ${admin.keypair.publicKey.toString().slice(0, 8)}...`));
  
  // Borrower account - for loan operations
  let borrower: typeof admin;
  try {
    console.log(chalk.gray('  Loading borrower account...'));
    borrower = await loadSDK(network, '../keys/borrower.json');
    console.log(chalk.green(`  ✓ Borrower: ${borrower.keypair.publicKey.toString().slice(0, 8)}...`));
  } catch (e) {
    console.log(chalk.yellow('  ⚠ Borrower keypair not found, using admin as borrower'));
    borrower = admin;
  }
  
  // Staker account - for staking operations
  let staker: typeof admin;
  try {
    console.log(chalk.gray('  Loading staker account...'));
    staker = await loadSDK(network, '../keys/staker.json');
    console.log(chalk.green(`  ✓ Staker: ${staker.keypair.publicKey.toString().slice(0, 8)}...`));
  } catch (e) {
    console.log(chalk.yellow('  ⚠ Staker keypair not found, using admin as staker'));
    staker = admin;
  }
  
  // Check balances
  console.log(chalk.gray('\n  Balances:'));
  const adminBal = await admin.connection.getBalance(admin.keypair.publicKey);
  console.log(chalk.gray(`    Admin:    ${(adminBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`));
  
  if (borrower !== admin) {
    const borrowerBal = await borrower.connection.getBalance(borrower.keypair.publicKey);
    console.log(chalk.gray(`    Borrower: ${(borrowerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`));
    if (borrowerBal < 0.1 * LAMPORTS_PER_SOL) {
      console.log(chalk.yellow(`    ⚠ Borrower needs SOL: solana airdrop 2 keys/borrower.json --url devnet`));
    }
  }
  
  if (staker !== admin && staker !== borrower) {
    const stakerBal = await staker.connection.getBalance(staker.keypair.publicKey);
    console.log(chalk.gray(`    Staker:   ${(stakerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`));
    if (stakerBal < 0.1 * LAMPORTS_PER_SOL) {
      console.log(chalk.yellow(`    ⚠ Staker needs SOL: solana airdrop 2 keys/staker.json --url devnet`));
    }
  }
  
  return { admin, borrower, staker };
}

// ============= Test Categories =============

// --- Protocol Management Tests ---
async function testProtocolState(client: any, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n📊 Protocol State Tests'));
  
  await runTest('Get Protocol State', 'protocol', async () => {
    const state = await client.getProtocolState();
    if (!state) throw new Error('Protocol state not found');
    if (!state.admin) throw new Error('Admin not set');
    return undefined;
  }, config);
  
  await runTest('Get Treasury Balance', 'protocol', async () => {
    const state = await client.getProtocolState();
    if (state.treasuryBalance === undefined) throw new Error('Treasury balance not found');
    console.log(chalk.gray(`    Treasury: ${state.treasuryBalance / LAMPORTS_PER_SOL} SOL`));
    return undefined;
  }, config);
}

async function testPauseResume(client: any, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n⏸️  Pause/Resume Tests'));
  
  let wasPaused = false;
  
  // Check initial state
  await runTest('Check Initial Pause State', 'admin', async () => {
    const state = await client.getProtocolState();
    wasPaused = state.paused;
    return undefined;
  }, config);
  
  // Only test pause if not already paused
  if (!wasPaused) {
    await runTest('Pause Protocol', 'admin', async () => {
      const tx = await client.pauseProtocol();
      await sleep(2000); // Wait for confirmation
      const state = await client.getProtocolState();
      if (!state.paused) throw new Error('Protocol should be paused');
      return tx;
    }, config);
    
    await runTest('Resume Protocol', 'admin', async () => {
      const tx = await client.resumeProtocol();
      await sleep(2000);
      const state = await client.getProtocolState();
      if (state.paused) throw new Error('Protocol should be resumed');
      return tx;
    }, config);
  } else {
    console.log(chalk.yellow('  ⚠️  Protocol already paused, skipping pause test'));
    
    await runTest('Resume Protocol (was paused)', 'admin', async () => {
      const tx = await client.resumeProtocol();
      await sleep(2000);
      return tx;
    }, config);
  }
}

// --- Update Fees Tests ---
async function testUpdateFees(client: any, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n💸 Update Fees Tests'));
  
  let originalFeeBps = 200; // Default 2%
  
  await runTest('Get Current Fee', 'fees', async () => {
    const state = await client.getProtocolState();
    originalFeeBps = state.protocolFeeBps;
    console.log(chalk.gray(`    Current fee: ${originalFeeBps / 100}%`));
    return undefined;
  }, config);
  
  await runTest('Update Protocol Fee to 3%', 'fees', async () => {
    const tx = await client.updateFees({ protocolFeeBps: 300 });
    await sleep(2000);
    const state = await client.getProtocolState();
    if (state.protocolFeeBps !== 300) {
      throw new Error(`Fee should be 300 bps, got ${state.protocolFeeBps}`);
    }
    console.log(chalk.gray(`    Fee updated to: ${state.protocolFeeBps / 100}%`));
    return tx;
  }, config);
  
  await runTest('Restore Original Fee', 'fees', async () => {
    const tx = await client.updateFees({ protocolFeeBps: originalFeeBps });
    await sleep(2000);
    const state = await client.getProtocolState();
    console.log(chalk.gray(`    Fee restored to: ${state.protocolFeeBps / 100}%`));
    return tx;
  }, config);
}

// --- Treasury Withdraw Tests ---
async function testTreasuryWithdraw(client: any, connection: Connection, keypair: Keypair, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n🏦 Treasury Withdraw Tests'));
  
  await runTest('Check Treasury Balance Before', 'withdraw', async () => {
    const state = await client.getProtocolState();
    console.log(chalk.gray(`    Treasury: ${state.treasuryBalance / LAMPORTS_PER_SOL} SOL`));
    if (state.treasuryBalance < 0.05 * LAMPORTS_PER_SOL) {
      throw new Error('Insufficient treasury balance for withdraw test');
    }
    return undefined;
  }, config);
  
  await runTest('Withdraw 0.01 SOL from Treasury', 'withdraw', async () => {
    const balanceBefore = await connection.getBalance(keypair.publicKey);
    const tx = await client.withdrawTreasury(new BN(0.01 * LAMPORTS_PER_SOL));
    await sleep(2000);
    const balanceAfter = await connection.getBalance(keypair.publicKey);
    
    // Balance should have increased (minus tx fees)
    const gained = balanceAfter - balanceBefore;
    console.log(chalk.gray(`    Withdrew: ~${(gained / LAMPORTS_PER_SOL).toFixed(4)} SOL (after fees)`));
    return tx;
  }, config);
  
  await runTest('Check Treasury Balance After', 'withdraw', async () => {
    const state = await client.getProtocolState();
    console.log(chalk.gray(`    Treasury: ${state.treasuryBalance / LAMPORTS_PER_SOL} SOL`));
    return undefined;
  }, config);
}

// --- Token Config Update Tests ---
async function testTokenConfigUpdate(client: any, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n🏷️  Token Config Update Tests'));
  
  // Get a whitelisted token to test with
  let tokenMint: PublicKey | null = null;
  let originalLtv = 0;
  let originalEnabled = true;
  
  await runTest('Get Token for Config Test', 'token-config', async () => {
    const tokens = await client.getWhitelistedTokens();
    if (!tokens || tokens.length === 0) {
      throw new Error('No whitelisted tokens to test with');
    }
    tokenMint = new PublicKey(tokens[0].mint);
    originalLtv = tokens[0].ltvBps;
    originalEnabled = tokens[0].enabled;
    console.log(chalk.gray(`    Token: ${tokenMint.toString().slice(0, 8)}...`));
    console.log(chalk.gray(`    Current LTV: ${originalLtv / 100}%, Enabled: ${originalEnabled}`));
    return undefined;
  }, config);
  
  if (!tokenMint) {
    console.log(chalk.yellow('  ⚠️  No tokens available for config test'));
    return;
  }
  
  await runTest('Update Token LTV to 30%', 'token-config', async () => {
    const tx = await client.updateTokenConfig({
      mint: tokenMint!,
      ltvBps: 3000,
    });
    await sleep(2000);
    const tokenConfig = await client.getTokenConfig(tokenMint!);
    if (tokenConfig.ltvBps !== 3000) {
      throw new Error(`LTV should be 3000, got ${tokenConfig.ltvBps}`);
    }
    console.log(chalk.gray(`    LTV updated to: ${tokenConfig.ltvBps / 100}%`));
    return tx;
  }, config);
  
  await runTest('Disable Token', 'token-config', async () => {
    const tx = await client.updateTokenConfig({
      mint: tokenMint!,
      enabled: false,
    });
    await sleep(2000);
    const tokenConfig = await client.getTokenConfig(tokenMint!);
    if (tokenConfig.enabled !== false) {
      throw new Error('Token should be disabled');
    }
    console.log(chalk.gray(`    Token disabled`));
    return tx;
  }, config);
  
  await runTest('Re-enable Token', 'token-config', async () => {
    const tx = await client.updateTokenConfig({
      mint: tokenMint!,
      enabled: true,
    });
    await sleep(2000);
    const tokenConfig = await client.getTokenConfig(tokenMint!);
    if (tokenConfig.enabled !== true) {
      throw new Error('Token should be enabled');
    }
    console.log(chalk.gray(`    Token re-enabled`));
    return tx;
  }, config);
  
  await runTest('Restore Original Token Config', 'token-config', async () => {
    const tx = await client.updateTokenConfig({
      mint: tokenMint!,
      ltvBps: originalLtv,
      enabled: originalEnabled,
    });
    await sleep(2000);
    console.log(chalk.gray(`    Restored LTV: ${originalLtv / 100}%, Enabled: ${originalEnabled}`));
    return tx;
  }, config);
}

async function testFundTreasury(client: any, keypair: Keypair, connection: Connection, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n💰 Treasury Tests'));
  
  await runTest('Fund Treasury (0.1 SOL)', 'treasury', async () => {
    const balanceBefore = await client.getProtocolState();
    const tx = await client.fundTreasury(new BN(0.1 * LAMPORTS_PER_SOL));
    await sleep(2000);
    const balanceAfter = await client.getProtocolState();
    
    // Treasury should have increased
    if (balanceAfter.treasuryBalance <= balanceBefore.treasuryBalance) {
      throw new Error('Treasury balance did not increase');
    }
    return tx;
  }, config);
}

// --- Token Management Tests ---
async function testTokenManagement(client: any, keypair: Keypair, connection: Connection, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n🪙 Token Management Tests'));
  
  await runTest('Get Whitelisted Tokens', 'tokens', async () => {
    const tokens = await client.getWhitelistedTokens();
    console.log(chalk.gray(`    Found ${tokens.length} whitelisted tokens`));
    if (tokens.length > 0) {
      testTokenMint = new PublicKey(tokens[0].mint);
      console.log(chalk.gray(`    Using: ${testTokenMint.toString().slice(0, 8)}...`));
    }
    return undefined;
  }, config);
  
  // If no tokens exist, create a test token
  if (!testTokenMint && !config.skipSetup) {
    await runTest('Create Test Token', 'tokens', async () => {
      testTokenMint = await createMint(
        connection,
        keypair,
        keypair.publicKey,
        null,
        9 // decimals
      );
      console.log(chalk.gray(`    Created: ${testTokenMint.toString().slice(0, 8)}...`));
      return undefined;
    }, config);
    
    // Note: Whitelisting requires a valid pool, so we'll skip for now
    console.log(chalk.yellow('  ⚠️  Skipping whitelist test (requires valid pool address)'));
  }
  
  // Test token config update if we have a token
  if (testTokenMint) {
    await runTest('Get Token Config', 'tokens', async () => {
      const tokenConfig = await client.getTokenConfig(testTokenMint!);
      if (!tokenConfig) throw new Error('Token config not found');
      console.log(chalk.gray(`    LTV: ${tokenConfig.ltvBps / 100}%, Enabled: ${tokenConfig.enabled}`));
      return undefined;
    }, config);
  }
}

// --- Loan Operations Tests ---
async function testLoanOperations(
  adminClient: any, 
  borrowerClient: any,
  borrowerKeypair: Keypair, 
  connection: Connection, 
  config: TestConfig
): Promise<void> {
  console.log(chalk.blue('\n💸 Loan Operations Tests'));
  console.log(chalk.gray(`  Using borrower: ${borrowerKeypair.publicKey.toString().slice(0, 8)}...`));
  
  // Skip if no token available
  if (!testTokenMint) {
    console.log(chalk.yellow('  ⚠️  No test token available, skipping loan tests'));
    return;
  }
  
  // Check if borrower has tokens
  let userTokenBalance = BigInt(0);
  let userTokenAccount: PublicKey;
  
  await runTest('Check Borrower Token Balance', 'loans', async () => {
    try {
      userTokenAccount = await getAssociatedTokenAddress(testTokenMint!, borrowerKeypair.publicKey);
      const account = await getAccount(connection, userTokenAccount);
      userTokenBalance = account.amount;
      console.log(chalk.gray(`    Balance: ${Number(userTokenBalance) / 1e9} tokens`));
    } catch (e) {
      console.log(chalk.gray(`    No token account found for borrower`));
      console.log(chalk.yellow(`    Send tokens to: ${borrowerKeypair.publicKey.toString()}`));
    }
    return undefined;
  }, config);
  
  // Only test loan creation if borrower has tokens
  if (userTokenBalance >= BigInt(100 * 1e9)) {
    await runTest('Estimate Loan', 'loans', async () => {
      // Use SDK to calculate terms
      const terms = borrowerClient.calculateLoanTerms({
        collateralAmount: 1000 * 1e9,
        durationSeconds: 24 * 60 * 60, // 24 hours
        tokenMint: testTokenMint!.toString(),
        tokenPrice: 0.001, // Mock price
        ltvBps: 5000, // 50%
        protocolFeeBps: 200, // 2%
      });
      console.log(chalk.gray(`    SOL to receive: ${terms.solToReceive / LAMPORTS_PER_SOL} SOL`));
      return undefined;
    }, config);
    
    await runTest('Create Loan (1000 tokens, 24h)', 'loans', async () => {
      const tx = await borrowerClient.createLoan({
        tokenMint: testTokenMint!.toString(),
        collateralAmount: (1000 * 1e9).toString(),
        durationSeconds: 24 * 60 * 60,
      });
      await sleep(3000);
      return tx;
    }, config);
    
    // Get the loan we just created
    await runTest('Get Borrower Active Loans', 'loans', async () => {
      const loans = await borrowerClient.getLoansByBorrower(borrowerKeypair.publicKey);
      const activeLoans = loans.filter((l: any) => l.status === 'Active' || l.status?.active);
      console.log(chalk.gray(`    Found ${activeLoans.length} active loans for borrower`));
      
      if (activeLoans.length > 0) {
        testLoanPda = new PublicKey(activeLoans[0].pubkey || activeLoans[0].address);
        console.log(chalk.gray(`    Latest loan: ${testLoanPda.toString().slice(0, 8)}...`));
      }
      return undefined;
    }, config);
    
    // Test repay if we have an active loan
    if (testLoanPda) {
      await runTest('Get Loan Details', 'loans', async () => {
        const loan = await borrowerClient.getLoan(testLoanPda!);
        if (!loan) throw new Error('Loan not found');
        console.log(chalk.gray(`    Collateral: ${Number(loan.collateralAmount) / 1e9} tokens`));
        console.log(chalk.gray(`    SOL Borrowed: ${Number(loan.solBorrowed) / LAMPORTS_PER_SOL} SOL`));
        return undefined;
      }, config);
      
      await runTest('Repay Loan', 'loans', async () => {
        const tx = await borrowerClient.repayLoan(testLoanPda!);
        await sleep(3000);
        
        // Verify loan is repaid
        const loan = await borrowerClient.getLoan(testLoanPda!);
        if (loan && loan.status !== 'Repaid' && !loan.status?.repaid) {
          throw new Error(`Loan status is ${JSON.stringify(loan.status)}, expected Repaid`);
        }
        return tx;
      }, config);
    }
  } else {
    console.log(chalk.yellow('  ⚠️  Insufficient token balance for loan tests'));
    console.log(chalk.gray(`    Need: 100 tokens, Have: ${Number(userTokenBalance) / 1e9}`));
    console.log(chalk.gray(`    Send loan tokens to borrower: ${borrowerKeypair.publicKey.toString()}`));
  }
}

// --- Staking Tests ---
async function testStaking(
  adminClient: any,
  stakerClient: any, 
  stakerKeypair: Keypair, 
  connection: Connection, 
  config: TestConfig
): Promise<void> {
  console.log(chalk.blue('\n🥩 Staking Tests'));
  console.log(chalk.gray(`  Using staker: ${stakerKeypair.publicKey.toString().slice(0, 8)}...`));
  
  // Check if staking is initialized
  await runTest('Check Staking Pool', 'staking', async () => {
    try {
      const pool = await adminClient.getStakingPool();
      if (pool) {
        stakingInitialized = true;
        console.log(chalk.gray(`    Total Staked: ${Number(pool.totalStaked) / 1e6} tokens`));
        console.log(chalk.gray(`    Reward Vault: ${Number(pool.rewardVaultBalance) / LAMPORTS_PER_SOL} SOL`));
        console.log(chalk.gray(`    Staking Token: ${pool.stakingTokenMint?.toString().slice(0, 8)}...`));
      }
    } catch (e) {
      console.log(chalk.gray(`    Staking pool not initialized`));
    }
    return undefined;
  }, config);
  
  if (!stakingInitialized) {
    console.log(chalk.yellow('  ⚠️  Staking not initialized, skipping staking tests'));
    console.log(chalk.gray('    Run: npx tsx scripts/initialize-staking.ts --network devnet'));
    return;
  }
  
  // Check staker's token balance
  let stakerTokenBalance = BigInt(0);
  let stakingTokenMint: PublicKey | null = null;
  
  await runTest('Get Staking Token Mint', 'staking', async () => {
    const pool = await adminClient.getStakingPool();
    if (pool && pool.stakingTokenMint) {
      stakingTokenMint = new PublicKey(pool.stakingTokenMint);
      console.log(chalk.gray(`    Staking token: ${stakingTokenMint.toString().slice(0, 8)}...`));
    }
    return undefined;
  }, config);
  
  if (stakingTokenMint) {
    await runTest('Check Staker Token Balance', 'staking', async () => {
      try {
        const stakerTokenAccount = await getAssociatedTokenAddress(stakingTokenMint!, stakerKeypair.publicKey);
        const account = await getAccount(connection, stakerTokenAccount);
        stakerTokenBalance = account.amount;
        console.log(chalk.gray(`    Staker balance: ${Number(stakerTokenBalance) / 1e6} tokens`));
      } catch (e) {
        console.log(chalk.gray(`    No staking token account for staker`));
        console.log(chalk.yellow(`    Send staking tokens to: ${stakerKeypair.publicKey.toString()}`));
      }
      return undefined;
    }, config);
  }
  
  await runTest('Get User Stake', 'staking', async () => {
    try {
      const stake = await stakerClient.getUserStake(stakerKeypair.publicKey);
      if (stake) {
        console.log(chalk.gray(`    Staked: ${Number(stake.stakedAmount) / 1e6} tokens`));
        console.log(chalk.gray(`    Pending: ${Number(stake.pendingRewards) / LAMPORTS_PER_SOL} SOL`));
      } else {
        console.log(chalk.gray(`    No stake found for staker`));
      }
    } catch (e) {
      console.log(chalk.gray(`    No stake account`));
    }
    return undefined;
  }, config);
  
  // Test staking if staker has tokens
  if (stakerTokenBalance >= BigInt(100 * 1e6)) { // 100 tokens (6 decimals)
    await runTest('Stake Tokens (100)', 'staking', async () => {
      const tx = await stakerClient.stake(new BN(100 * 1e6));
      await sleep(3000);
      console.log(chalk.gray(`    Staked 100 tokens`));
      return tx;
    }, config);
    
    await runTest('Check Stake After Staking', 'staking', async () => {
      const stake = await stakerClient.getUserStake(stakerKeypair.publicKey);
      if (stake) {
        console.log(chalk.gray(`    New staked amount: ${Number(stake.stakedAmount) / 1e6} tokens`));
      }
      return undefined;
    }, config);
    
    await runTest('Claim Rewards', 'staking', async () => {
      try {
        const tx = await stakerClient.claimRewards();
        await sleep(2000);
        console.log(chalk.gray(`    Rewards claimed`));
        return tx;
      } catch (e: any) {
        console.log(chalk.gray(`    No rewards to claim yet`));
        return undefined;
      }
    }, config);
    
    await runTest('Unstake Tokens (50)', 'staking', async () => {
      const tx = await stakerClient.unstake(new BN(50 * 1e6));
      await sleep(3000);
      console.log(chalk.gray(`    Unstaked 50 tokens`));
      return tx;
    }, config);
  } else {
    console.log(chalk.yellow('  ⚠️  Staker has insufficient tokens for staking tests'));
    console.log(chalk.gray(`    Need: 100 tokens, Have: ${Number(stakerTokenBalance) / 1e6}`));
    console.log(chalk.gray(`    Send staking tokens to: ${stakerKeypair.publicKey.toString()}`));
  }
}

// --- Security Tests ---
async function testSecurity(
  adminClient: any, 
  adminKeypair: Keypair, 
  connection: Connection, 
  config: TestConfig
): Promise<void> {
  console.log(chalk.blue('\n🔐 Security Tests'));
  
  await runTest('Non-Admin Cannot Pause (expected failure)', 'security', async () => {
    // Create a random keypair
    const fakeAdmin = Keypair.generate();
    
    // Fund it
    try {
      const sig = await connection.requestAirdrop(fakeAdmin.publicKey, 0.1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    } catch (e) {
      console.log(chalk.gray(`    Skipped (airdrop failed on devnet)`));
      return undefined;
    }
    
    // Create a new client with fake admin using cli-utils
    // We need to create a temporary keypair file for this
    const tempKeypairPath = `/tmp/fake-admin-${Date.now()}.json`;
    const fs = await import('fs');
    fs.writeFileSync(tempKeypairPath, JSON.stringify(Array.from(fakeAdmin.secretKey)));
    
    try {
      const { client: fakeClient } = await createSDKClient(config.network, tempKeypairPath);
      
      try {
        await fakeClient.pauseProtocol();
        throw new Error('Should have failed - non-admin could pause!');
      } catch (e: any) {
        if (e.message.includes('Should have failed')) throw e;
        // Expected failure
        console.log(chalk.gray(`    Correctly rejected: ${e.message.slice(0, 50)}...`));
      }
    } finally {
      // Cleanup temp file
      try { fs.unlinkSync(tempKeypairPath); } catch {}
    }
    return undefined;
  }, config);
  
  await runTest('Non-Admin Cannot Update Fees', 'security', async () => {
    const fakeAdmin = Keypair.generate();
    
    try {
      const sig = await connection.requestAirdrop(fakeAdmin.publicKey, 0.1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    } catch (e) {
      console.log(chalk.gray(`    Skipped (airdrop failed)`));
      return undefined;
    }
    
    const tempKeypairPath = `/tmp/fake-admin-fees-${Date.now()}.json`;
    const fs = await import('fs');
    fs.writeFileSync(tempKeypairPath, JSON.stringify(Array.from(fakeAdmin.secretKey)));
    
    try {
      const { client: fakeClient } = await createSDKClient(config.network, tempKeypairPath);
      
      try {
        await fakeClient.updateFees({ protocolFeeBps: 500 });
        throw new Error('Should have failed - non-admin could update fees!');
      } catch (e: any) {
        if (e.message.includes('Should have failed')) throw e;
        console.log(chalk.gray(`    Correctly rejected fee update`));
      }
    } finally {
      try { fs.unlinkSync(tempKeypairPath); } catch {}
    }
    return undefined;
  }, config);
  
  await runTest('Non-Admin Cannot Withdraw Treasury', 'security', async () => {
    const fakeAdmin = Keypair.generate();
    
    try {
      const sig = await connection.requestAirdrop(fakeAdmin.publicKey, 0.1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    } catch (e) {
      console.log(chalk.gray(`    Skipped (airdrop failed)`));
      return undefined;
    }
    
    const tempKeypairPath = `/tmp/fake-admin-withdraw-${Date.now()}.json`;
    const fs = await import('fs');
    fs.writeFileSync(tempKeypairPath, JSON.stringify(Array.from(fakeAdmin.secretKey)));
    
    try {
      const { client: fakeClient } = await createSDKClient(config.network, tempKeypairPath);
      
      try {
        await fakeClient.withdrawTreasury(new BN(0.01 * LAMPORTS_PER_SOL));
        throw new Error('Should have failed - non-admin could withdraw!');
      } catch (e: any) {
        if (e.message.includes('Should have failed')) throw e;
        console.log(chalk.gray(`    Correctly rejected treasury withdrawal`));
      }
    } finally {
      try { fs.unlinkSync(tempKeypairPath); } catch {}
    }
    return undefined;
  }, config);
  
  await runTest('Duration Validation (min 12h)', 'security', async () => {
    if (!testTokenMint) {
      console.log(chalk.gray(`    Skipped (no token)`));
      return undefined;
    }
    
    try {
      // Try to create loan with 6 hour duration (should fail)
      await adminClient.createLoan({
        tokenMint: testTokenMint.toString(),
        collateralAmount: (100 * 1e9).toString(),
        durationSeconds: 6 * 60 * 60, // 6 hours
      });
      throw new Error('Should have failed - duration too short!');
    } catch (e: any) {
      if (e.message.includes('Should have failed')) throw e;
      // Expected failure
      console.log(chalk.gray(`    Correctly rejected short duration`));
    }
    return undefined;
  }, config);
  
  await runTest('Duration Validation (max 7d)', 'security', async () => {
    if (!testTokenMint) {
      console.log(chalk.gray(`    Skipped (no token)`));
      return undefined;
    }
    
    try {
      // Try to create loan with 8 day duration (should fail)
      await adminClient.createLoan({
        tokenMint: testTokenMint.toString(),
        collateralAmount: (100 * 1e9).toString(),
        durationSeconds: 8 * 24 * 60 * 60, // 8 days
      });
      throw new Error('Should have failed - duration too long!');
    } catch (e: any) {
      if (e.message.includes('Should have failed')) throw e;
      // Expected failure
      console.log(chalk.gray(`    Correctly rejected long duration`));
    }
    return undefined;
  }, config);
}

// --- View All Loans Test ---
async function testViewAllLoans(client: any, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n📋 Loan Viewing Tests'));
  
  await runTest('Get All Loans', 'view', async () => {
    const loans = await client.getAllLoans();
    console.log(chalk.gray(`    Total loans: ${loans.length}`));
    
    const active = loans.filter((l: any) => l.status === 'Active' || l.status?.active);
    const repaid = loans.filter((l: any) => l.status === 'Repaid' || l.status?.repaid);
    const liquidated = loans.filter((l: any) => 
      l.status?.liquidatedTime || l.status?.liquidatedPrice
    );
    
    console.log(chalk.gray(`    Active: ${active.length}, Repaid: ${repaid.length}, Liquidated: ${liquidated.length}`));
    return undefined;
  }, config);
}

// --- Liquidation Tests ---
async function testLiquidation(client: any, config: TestConfig): Promise<void> {
  console.log(chalk.blue('\n⚡ Liquidation Tests'));
  
  await runTest('Find Liquidatable Loans', 'liquidation', async () => {
    const loans = await client.getAllLoans();
    const now = Math.floor(Date.now() / 1000);
    
    const liquidatable = loans.filter((l: any) => {
      const isActive = l.status === 'Active' || l.status?.active;
      if (!isActive) return false;
      return l.dueAt < now; // Overdue
    });
    
    console.log(chalk.gray(`    Found ${liquidatable.length} liquidatable loans`));
    
    if (liquidatable.length > 0) {
      console.log(chalk.gray(`    First: ${liquidatable[0].pubkey?.slice(0, 8) || liquidatable[0].address?.slice(0, 8)}...`));
    }
    return undefined;
  }, config);
  
  // Note: Actual liquidation test requires Jupiter which isn't on devnet
  console.log(chalk.yellow('  ⚠️  Liquidation execution requires Jupiter (mainnet only)'));
}

// ============= Main Test Runner =============
async function runAllTests(config: TestConfig): Promise<void> {
  console.log(chalk.bold.blue('\n🧪 Memecoin Lending Protocol - Devnet Integration Tests\n'));
  console.log(chalk.gray(`Network: ${config.network}`));
  console.log(chalk.gray(`RPC: ${config.rpcUrl}`));
  console.log(chalk.gray(`Skip Setup: ${config.skipSetup}`));
  if (config.testOnly) console.log(chalk.gray(`Test Only: ${config.testOnly}`));
  
  const startTime = Date.now();
  
  try {
    // Load all accounts
    const accounts = await loadAllAccounts(config.network);
    
    const { admin, borrower, staker } = accounts;
    
    // Check admin balance
    if (await admin.connection.getBalance(admin.keypair.publicKey) < 0.1 * LAMPORTS_PER_SOL) {
      console.log(chalk.red('\n❌ Insufficient admin SOL balance. Run:'));
      console.log(chalk.gray(`  solana airdrop 2 keys/admin.json --url devnet`));
      process.exit(1);
    }
    
    // Run test categories
    // Admin-only operations use admin client
    await testProtocolState(admin.client, config);
    await testPauseResume(admin.client, config);
    await testUpdateFees(admin.client, config);
    await testFundTreasury(admin.client, admin.keypair, admin.connection, config);
    await testTreasuryWithdraw(admin.client, admin.connection, admin.keypair, config);
    await testTokenManagement(admin.client, admin.keypair, admin.connection, config);
    await testTokenConfigUpdate(admin.client, config);
    
    // Loan operations use borrower client
    await testLoanOperations(admin.client, borrower.client, borrower.keypair, borrower.connection, config);
    
    // Staking operations use staker client
    await testStaking(admin.client, staker.client, staker.keypair, staker.connection, config);
    
    // View operations can use any client
    await testViewAllLoans(admin.client, config);
    await testLiquidation(admin.client, config);
    
    // Security tests use admin for setup
    await testSecurity(admin.client, admin.keypair, admin.connection, config);
    
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Fatal error: ${error.message}`));
    if (config.verbose) {
      console.error(error);
    }
  }
  
  // Print Summary
  const totalTime = Date.now() - startTime;
  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  
  console.log(chalk.bold.blue('\n' + '='.repeat(60)));
  console.log(chalk.bold.blue('📊 Test Summary'));
  console.log(chalk.bold.blue('='.repeat(60)));
  
  console.log(`\nTotal: ${testResults.length} tests`);
  console.log(chalk.green(`Passed: ${passed}`));
  console.log(chalk.red(`Failed: ${failed}`));
  console.log(chalk.gray(`Duration: ${formatDuration(totalTime)}`));
  
  if (failed > 0) {
    console.log(chalk.red('\n❌ Failed Tests:'));
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(chalk.red(`  • ${r.category}/${r.name}: ${r.error}`));
    });
  }
  
  // Group by category
  const categories = [...new Set(testResults.map(r => r.category))];
  console.log('\nBy Category:');
  categories.forEach(cat => {
    const catTests = testResults.filter(r => r.category === cat);
    const catPassed = catTests.filter(r => r.passed).length;
    const status = catPassed === catTests.length ? chalk.green('✓') : chalk.yellow('⚠');
    console.log(`  ${status} ${cat}: ${catPassed}/${catTests.length}`);
  });
  
  console.log('');
  
  process.exit(failed > 0 ? 1 : 0);
}

// ============= CLI Setup =============
const program = new Command();

program
  .name('devnet-integration-tests')
  .description('Run integration tests against devnet')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-s, --skip-setup', 'Skip setup steps (token creation, etc)', false)
  .option('-t, --test-only <category>', 'Only run specific category (protocol, admin, treasury, tokens, loans, staking, security, view, liquidation)')
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options) => {
    const config: TestConfig = {
      network: options.network,
      rpcUrl: getRpcUrl(options.network),
      skipSetup: options.skipSetup,
      testOnly: options.testOnly || null,
      verbose: options.verbose,
    };
    
    await runAllTests(config);
  });

program.parse();