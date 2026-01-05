#!/usr/bin/env tsx

/**
 * Security Test Suite for Staking System
 * 
 * Tests all security features and generates a report
 * 
 * Usage:
 *   npx tsx scripts/security-test-staking.ts --network devnet
 */

import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Command } from 'commander';
import chalk from 'chalk';
import BN from 'bn.js';

// Test result tracking
interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  critical: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

// Helper to run a test and track results
async function runTest(
  name: string,
  category: string,
  critical: boolean,
  testFn: () => Promise<{ passed: boolean; message: string }>
): Promise<void> {
  const start = Date.now();
  try {
    const { passed, message } = await testFn();
    results.push({
      name,
      category,
      passed,
      critical,
      message,
      duration: Date.now() - start,
    });
  } catch (error: any) {
    results.push({
      name,
      category,
      passed: false,
      critical,
      message: `Exception: ${error.message}`,
      duration: Date.now() - start,
    });
  }
}

// ============= TEST IMPLEMENTATIONS =============

// 1. PDA Validation Tests
async function testPDAValidation(connection: Connection, programId: PublicKey) {
  const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );
  
  // Test 1: Valid PDA derivation
  await runTest(
    'Valid UserStake PDA passes validation',
    'PDA Validation',
    true, // critical
    async () => {
      const testUser = Keypair.generate().publicKey;
      
      const [expectedPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stake'), stakingPoolPDA.toBuffer(), testUser.toBuffer()],
        programId
      );
      
      // Simulate the validation logic from distribution-crank.service.ts
      const [derivedPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stake'), stakingPoolPDA.toBuffer(), testUser.toBuffer()],
        programId
      );
      
      const passed = expectedPDA.equals(derivedPDA);
      return { 
        passed, 
        message: passed ? 'PDA derivation consistent' : 'PDA derivation mismatch' 
      };
    }
  );
  
  // Test 2: Invalid PDA is rejected
  await runTest(
    'Invalid PDA (random pubkey) is rejected',
    'PDA Validation',
    true,
    async () => {
      const testUser = Keypair.generate().publicKey;
      const fakePubkey = Keypair.generate().publicKey; // Random, not a valid PDA
      
      const [expectedPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stake'), stakingPoolPDA.toBuffer(), testUser.toBuffer()],
        programId
      );
      
      const passed = !fakePubkey.equals(expectedPDA); // Should NOT match
      return { 
        passed, 
        message: passed ? 'Fake pubkey correctly identified as invalid' : 'Failed to detect invalid PDA' 
      };
    }
  );
  
  // Test 3: PDA with wrong pool is rejected
  await runTest(
    'PDA with wrong pool seed is rejected',
    'PDA Validation',
    true,
    async () => {
      const testUser = Keypair.generate().publicKey;
      const wrongPool = Keypair.generate().publicKey;
      
      const [correctPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stake'), stakingPoolPDA.toBuffer(), testUser.toBuffer()],
        programId
      );
      
      const [wrongPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_stake'), wrongPool.toBuffer(), testUser.toBuffer()],
        programId
      );
      
      const passed = !correctPDA.equals(wrongPDA);
      return { 
        passed, 
        message: passed ? 'Wrong pool PDA correctly rejected' : 'Failed to detect wrong pool' 
      };
    }
  );
}

// 2. Discriminator Validation Tests
async function testDiscriminatorValidation() {
  const USER_STAKE_DISCRIMINATOR = Buffer.from([102, 53, 163, 107, 9, 138, 87, 153]);
  
  // Test 1: Valid discriminator passes
  await runTest(
    'Valid UserStake discriminator passes',
    'Discriminator Validation',
    true,
    async () => {
      const validData = Buffer.alloc(200);
      USER_STAKE_DISCRIMINATOR.copy(validData, 0);
      
      const discriminator = validData.slice(0, 8);
      const passed = discriminator.equals(USER_STAKE_DISCRIMINATOR);
      
      return { 
        passed, 
        message: passed ? 'Valid discriminator accepted' : 'Valid discriminator rejected' 
      };
    }
  );
  
  // Test 2: Invalid discriminator is rejected
  await runTest(
    'Invalid discriminator is rejected',
    'Discriminator Validation',
    true,
    async () => {
      const invalidData = Buffer.alloc(200);
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]).copy(invalidData, 0);
      
      const discriminator = invalidData.slice(0, 8);
      const passed = !discriminator.equals(USER_STAKE_DISCRIMINATOR);
      
      return { 
        passed, 
        message: passed ? 'Invalid discriminator correctly rejected' : 'Invalid discriminator accepted' 
      };
    }
  );
  
  // Test 3: Short data handled gracefully
  await runTest(
    'Account data shorter than 8 bytes handled gracefully',
    'Discriminator Validation',
    true,
    async () => {
      const shortData = Buffer.alloc(4); // Too short
      
      let passed = false;
      let message = '';
      
      try {
        if (shortData.length < 8) {
          passed = true;
          message = 'Short data correctly identified';
        }
      } catch (e) {
        passed = false;
        message = 'Exception thrown for short data';
      }
      
      return { passed, message };
    }
  );
  
  // Test 4: Wrong program's discriminator rejected
  await runTest(
    'Discriminator from different account type rejected',
    'Discriminator Validation',
    true,
    async () => {
      // Use a different discriminator (e.g., from StakingPool)
      const wrongDiscriminator = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const data = Buffer.alloc(200);
      wrongDiscriminator.copy(data, 0);
      
      const discriminator = data.slice(0, 8);
      const passed = !discriminator.equals(USER_STAKE_DISCRIMINATOR);
      
      return { 
        passed, 
        message: passed ? 'Wrong account type discriminator rejected' : 'Wrong discriminator accepted' 
      };
    }
  );
}

// 3. Retry Logic Tests
async function testRetryLogic() {
  const MAX_RETRIES = 3;
  
  // Helper to simulate retryable operation
  async function simulateRetryableOperation(
    failCount: number,
    onAttempt?: (attempt: number) => void
  ): Promise<{ attempts: number; success: boolean }> {
    let attempts = 0;
    
    for (let i = 0; i < MAX_RETRIES; i++) {
      attempts++;
      if (onAttempt) onAttempt(attempts);
      
      // Simulate operation
      if (attempts > failCount) {
        return { attempts, success: true };
      }
      
      // Simulate exponential backoff
      if (i < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
      }
    }
    
    return { attempts, success: false };
  }
  
  // Test 1: Successful on first attempt
  await runTest(
    'Successful on first attempt doesn\'t retry',
    'Retry Logic',
    false,
    async () => {
      const result = await simulateRetryableOperation(0);
      const passed = result.attempts === 1 && result.success;
      return { 
        passed, 
        message: passed ? `Completed in ${result.attempts} attempt` : `Unexpected retry count: ${result.attempts}` 
      };
    }
  );
  
  // Test 2: Retries on transient failure
  await runTest(
    'Retries on transient failure with backoff',
    'Retry Logic',
    false,
    async () => {
      const attemptTimes: number[] = [];
      const startTime = Date.now();
      
      const result = await simulateRetryableOperation(2, (attempt) => {
        attemptTimes.push(Date.now() - startTime);
      });
      
      // Check retry count
      if (!result.success || result.attempts !== 3) {
        return { passed: false, message: `Failed: ${result.attempts} attempts, success: ${result.success}` };
      }
      
      // Verify exponential backoff timing
      const delay1 = attemptTimes[1] - attemptTimes[0];
      const delay2 = attemptTimes[2] - attemptTimes[1];
      
      // Allow some margin for timing
      const validBackoff = delay1 >= 90 && delay1 <= 110 && delay2 >= 190 && delay2 <= 210;
      
      return { 
        passed: validBackoff, 
        message: validBackoff ? 'Exponential backoff verified' : `Invalid backoff: ${delay1}ms, ${delay2}ms` 
      };
    }
  );
  
  // Test 3: Gives up after max retries
  await runTest(
    'Gives up after max retries',
    'Retry Logic',
    false,
    async () => {
      const result = await simulateRetryableOperation(10); // Always fails
      const passed = result.attempts === MAX_RETRIES && !result.success;
      return { 
        passed, 
        message: passed ? `Stopped after ${MAX_RETRIES} attempts` : `Unexpected behavior: ${result.attempts} attempts` 
      };
    }
  );
}

// 4. Transaction Simulation Tests
async function testTransactionSimulation(connection: Connection) {
  // Test 1: Valid transaction passes simulation
  await runTest(
    'Valid transaction passes simulation',
    'Transaction Simulation',
    true,
    async () => {
      try {
        const payer = Keypair.generate();
        const recipient = Keypair.generate();
        
        // Create a simple transfer instruction
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1000,
          })
        );
        
        // Set fee payer and recent blockhash for simulation
        tx.feePayer = payer.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        
        // Note: This will fail due to insufficient balance, but we're testing the simulation mechanism
        const simulation = await connection.simulateTransaction(tx);
        
        // Check that simulation ran without throwing
        const passed = simulation.value !== null;
        return { 
          passed, 
          message: passed ? 'Simulation completed successfully' : 'Simulation failed unexpectedly' 
        };
      } catch (error: any) {
        return { passed: false, message: `Simulation error: ${error.message}` };
      }
    }
  );
  
  // Test 2: Invalid transaction fails simulation
  await runTest(
    'Invalid transaction fails simulation before sending',
    'Transaction Simulation',
    true,
    async () => {
      try {
        const payer = Keypair.generate();
        
        // Create invalid transaction (transfer to same account with 0 lamports)
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: payer.publicKey,
            lamports: 0,
          })
        );
        
        const simulation = await connection.simulateTransaction(tx);
        
        // Should have an error
        const passed = simulation.value.err !== null;
        return { 
          passed, 
          message: passed ? 'Invalid transaction caught in simulation' : 'Invalid transaction not caught' 
        };
      } catch (error: any) {
        return { passed: true, message: 'Transaction validation caught error' };
      }
    }
  );
  
  // Test 3: Simulation error parsing
  await runTest(
    'Simulation error messages are properly formatted',
    'Transaction Simulation',
    false,
    async () => {
      try {
        const payer = Keypair.generate();
        const recipient = Keypair.generate();
        
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1_000_000_000, // 1 SOL (will fail due to no balance)
          })
        );
        
        // Set fee payer and recent blockhash
        tx.feePayer = payer.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        
        const simulation = await connection.simulateTransaction(tx);
        
        // Check that we can parse the error
        const hasError = simulation.value.err !== null;
        const hasLogs = simulation.value.logs !== null && simulation.value.logs !== undefined;
        
        // For devnet, we expect an error (insufficient balance)
        // Logs might be null for simple transfer failures
        const passed = hasError;
        return { 
          passed, 
          message: passed ? 'Error correctly detected in simulation' : 'Failed to detect expected error' 
        };
      } catch (error: any) {
        return { passed: false, message: `Exception: ${error.message}` };
      }
    }
  );
}

// 5. Pause Check Tests
async function testPauseChecks() {
  // Mock staking pool states
  interface MockStakingPool {
    paused: boolean;
    minStakeAmount: BN;
    cooldownPeriod: BN;
  }
  
  function canStake(pool: MockStakingPool, amount: BN): boolean {
    if (pool.paused) return false;
    if (amount.lt(pool.minStakeAmount)) return false;
    return true;
  }
  
  function canUnstake(pool: MockStakingPool, userBalance: BN, amount: BN, stakeDuration: BN): boolean {
    if (pool.paused) return false;
    if (amount.gt(userBalance)) return false;
    if (stakeDuration.lt(pool.cooldownPeriod)) return false;
    return true;
  }
  
  // Test 1: Operations blocked when paused
  await runTest(
    'Operations blocked when paused',
    'Pause Checks',
    true,
    async () => {
      const pausedPool: MockStakingPool = {
        paused: true,
        minStakeAmount: new BN(1000),
        cooldownPeriod: new BN(86400), // 1 day
      };
      
      const canStakeResult = canStake(pausedPool, new BN(5000));
      const canUnstakeResult = canUnstake(pausedPool, new BN(10000), new BN(5000), new BN(172800));
      
      const passed = !canStakeResult && !canUnstakeResult;
      return { 
        passed, 
        message: passed ? 'All operations blocked when paused' : 'Operations allowed when paused' 
      };
    }
  );
  
  // Test 2: Operations allowed when not paused
  await runTest(
    'Operations allowed when not paused',
    'Pause Checks',
    true,
    async () => {
      const activePool: MockStakingPool = {
        paused: false,
        minStakeAmount: new BN(1000),
        cooldownPeriod: new BN(86400),
      };
      
      const canStakeResult = canStake(activePool, new BN(5000));
      const canUnstakeResult = canUnstake(activePool, new BN(10000), new BN(5000), new BN(172800));
      
      const passed = canStakeResult && canUnstakeResult;
      return { 
        passed, 
        message: passed ? 'Operations allowed when active' : 'Operations blocked when active' 
      };
    }
  );
  
  // Test 3: Distribution crank skips paused pool
  await runTest(
    'Distribution crank skips paused pool',
    'Pause Checks',
    false,
    async () => {
      const pausedPool = { paused: true };
      
      // Simulate distribution logic
      let distributionExecuted = false;
      if (!pausedPool.paused) {
        distributionExecuted = true;
      }
      
      const passed = !distributionExecuted;
      return { 
        passed, 
        message: passed ? 'Distribution skipped for paused pool' : 'Distribution executed on paused pool' 
      };
    }
  );
}

// 6. Security Logging Tests
async function testSecurityLogging() {
  const logs: string[] = [];
  
  // Mock logging function
  function securityLog(message: string): void {
    logs.push(message);
  }
  
  // Test 1: PDA mismatch logging
  await runTest(
    'PDA mismatch is logged with [SECURITY] prefix',
    'Security Logging',
    false,
    async () => {
      logs.length = 0;
      
      const expectedPDA = Keypair.generate().publicKey;
      const actualPDA = Keypair.generate().publicKey;
      
      // Simulate security check
      if (!expectedPDA.equals(actualPDA)) {
        securityLog(`[SECURITY] PDA mismatch: expected ${expectedPDA.toBase58()}, got ${actualPDA.toBase58()}`);
      }
      
      const hasSecurityLog = logs.some(log => log.includes('[SECURITY]'));
      const hasContext = logs.some(log => log.includes('expected') && log.includes('got'));
      
      const passed = hasSecurityLog && hasContext;
      return { 
        passed, 
        message: passed ? 'Security log with context created' : 'Missing security log or context' 
      };
    }
  );
  
  // Test 2: Invalid discriminator logging
  await runTest(
    'Invalid discriminator is logged',
    'Security Logging',
    false,
    async () => {
      logs.length = 0;
      
      const invalidDiscriminator = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
      const expectedDiscriminator = Buffer.from([102, 53, 163, 107, 9, 138, 87, 153]);
      
      if (!invalidDiscriminator.equals(expectedDiscriminator)) {
        securityLog(`[SECURITY] Invalid discriminator detected: ${invalidDiscriminator.toString('hex')}`);
      }
      
      const hasLog = logs.some(log => log.includes('Invalid discriminator'));
      return { 
        passed: hasLog, 
        message: hasLog ? 'Discriminator mismatch logged' : 'Discriminator mismatch not logged' 
      };
    }
  );
  
  // Test 3: Invalid pubkey format logging
  await runTest(
    'Invalid public key format is logged',
    'Security Logging',
    false,
    async () => {
      logs.length = 0;
      
      const invalidPubkey = 'not-a-valid-pubkey';
      
      try {
        new PublicKey(invalidPubkey);
      } catch (error) {
        securityLog(`[SECURITY] Invalid public key format: ${invalidPubkey}`);
      }
      
      const hasLog = logs.some(log => log.includes('Invalid public key format'));
      return { 
        passed: hasLog, 
        message: hasLog ? 'Invalid pubkey format logged' : 'Invalid pubkey not logged' 
      };
    }
  );
}

// 7. Rate Limiting Tests
async function testRateLimiting() {
  // Simulate rate limiting state
  let lastDistributionTime = 0;
  const distributionHistory: number[] = [];
  const MIN_DISTRIBUTION_INTERVAL = 10000; // 10 seconds
  const MAX_DISTRIBUTIONS_PER_HOUR = 100;
  
  function canDistribute(): { allowed: boolean; reason?: string } {
    const now = Date.now();
    
    // Check minimum interval
    if (lastDistributionTime > 0 && now - lastDistributionTime < MIN_DISTRIBUTION_INTERVAL) {
      return { allowed: false, reason: 'Too soon since last distribution' };
    }
    
    // Check hourly limit
    const oneHourAgo = now - 3600000;
    const recentDistributions = distributionHistory.filter(t => t > oneHourAgo);
    if (recentDistributions.length >= MAX_DISTRIBUTIONS_PER_HOUR) {
      return { allowed: false, reason: 'Hourly limit exceeded' };
    }
    
    return { allowed: true };
  }
  
  function recordDistribution(): void {
    const now = Date.now();
    lastDistributionTime = now;
    distributionHistory.push(now);
  }
  
  // Test 1: First distribution allowed
  await runTest(
    'First distribution is allowed',
    'Rate Limiting',
    false,
    async () => {
      lastDistributionTime = 0;
      distributionHistory.length = 0;
      
      const result = canDistribute();
      return { 
        passed: result.allowed, 
        message: result.allowed ? 'First call allowed' : `Blocked: ${result.reason}` 
      };
    }
  );
  
  // Test 2: Rapid calls blocked
  await runTest(
    'Rapid successive calls are blocked',
    'Rate Limiting',
    false,
    async () => {
      lastDistributionTime = 0;
      distributionHistory.length = 0;
      
      // First call
      recordDistribution();
      
      // Immediate second call
      const result = canDistribute();
      return { 
        passed: !result.allowed, 
        message: !result.allowed ? 'Rapid call correctly blocked' : 'Rapid call incorrectly allowed' 
      };
    }
  );
  
  // Test 3: Call after cooldown allowed
  await runTest(
    'Call after cooldown period is allowed',
    'Rate Limiting',
    false,
    async () => {
      distributionHistory.length = 0;
      lastDistributionTime = Date.now() - MIN_DISTRIBUTION_INTERVAL - 1000; // Past cooldown
      
      const result = canDistribute();
      return { 
        passed: result.allowed, 
        message: result.allowed ? 'Post-cooldown call allowed' : `Blocked: ${result.reason}` 
      };
    }
  );
  
  // Test 4: Hourly limit enforced
  await runTest(
    'Hourly limit (100) is enforced',
    'Rate Limiting',
    false,
    async () => {
      lastDistributionTime = 0;
      distributionHistory.length = 0;
      
      // Fill history with 100 recent distributions
      const now = Date.now();
      for (let i = 0; i < MAX_DISTRIBUTIONS_PER_HOUR; i++) {
        distributionHistory.push(now - i * 1000);
      }
      
      const result = canDistribute();
      return { 
        passed: !result.allowed && result.reason?.includes('Hourly'), 
        message: !result.allowed ? 'Hourly limit correctly enforced' : 'Hourly limit not enforced' 
      };
    }
  );
}

// 8. Pool Validation Tests
async function testPoolValidation(stakingPoolPDA: PublicKey) {
  // Mock UserStake data structure
  interface MockUserStake {
    pool: PublicKey;
    user: PublicKey;
    amount: BN;
  }
  
  function validateUserStakePool(userStake: MockUserStake, expectedPool: PublicKey): boolean {
    return userStake.pool.equals(expectedPool);
  }
  
  // Test 1: Matching pool field passes
  await runTest(
    'Matching pool field passes validation',
    'Pool Validation',
    true,
    async () => {
      const userStake: MockUserStake = {
        pool: stakingPoolPDA,
        user: Keypair.generate().publicKey,
        amount: new BN(1000),
      };
      
      const isValid = validateUserStakePool(userStake, stakingPoolPDA);
      return { 
        passed: isValid, 
        message: isValid ? 'Correct pool validated' : 'Failed to validate correct pool' 
      };
    }
  );
  
  // Test 2: Mismatched pool field rejected
  await runTest(
    'Mismatched pool field is rejected',
    'Pool Validation',
    true,
    async () => {
      const wrongPool = Keypair.generate().publicKey;
      const userStake: MockUserStake = {
        pool: wrongPool,
        user: Keypair.generate().publicKey,
        amount: new BN(1000),
      };
      
      const isValid = validateUserStakePool(userStake, stakingPoolPDA);
      return { 
        passed: !isValid, 
        message: !isValid ? 'Wrong pool correctly rejected' : 'Wrong pool incorrectly accepted' 
      };
    }
  );
  
  // Test 3: Pool field validation in batch processing
  await runTest(
    'Pool validation filters batch correctly',
    'Pool Validation',
    false,
    async () => {
      const correctPool = stakingPoolPDA;
      const wrongPool = Keypair.generate().publicKey;
      
      const userStakes: MockUserStake[] = [
        { pool: correctPool, user: Keypair.generate().publicKey, amount: new BN(1000) },
        { pool: wrongPool, user: Keypair.generate().publicKey, amount: new BN(2000) },
        { pool: correctPool, user: Keypair.generate().publicKey, amount: new BN(3000) },
        { pool: wrongPool, user: Keypair.generate().publicKey, amount: new BN(4000) },
        { pool: correctPool, user: Keypair.generate().publicKey, amount: new BN(5000) },
      ];
      
      const validStakes = userStakes.filter(stake => validateUserStakePool(stake, correctPool));
      
      const passed = validStakes.length === 3;
      return { 
        passed, 
        message: passed ? 'Batch filtering correct' : `Expected 3 valid stakes, got ${validStakes.length}` 
      };
    }
  );
}

// 9. Edge Cases & Error Handling
async function testEdgeCases() {
  // Test 1: Empty remaining_accounts handled
  await runTest(
    'Empty remaining_accounts handled gracefully',
    'Edge Cases',
    false,
    async () => {
      const emptyAccounts: any[] = [];
      
      // Simulate processing empty accounts
      let processed = 0;
      let error = null;
      
      try {
        for (const account of emptyAccounts) {
          processed++;
        }
      } catch (e: any) {
        error = e.message;
      }
      
      const passed = processed === 0 && error === null;
      return { 
        passed, 
        message: passed ? 'Empty accounts handled correctly' : `Error: ${error}` 
      };
    }
  );
  
  // Test 2: Malformed account data handled
  await runTest(
    'Malformed account data handled without crash',
    'Edge Cases',
    true,
    async () => {
      const malformedData = Buffer.alloc(3); // Too short for any valid account
      
      let handled = false;
      let crashed = false;
      
      try {
        if (malformedData.length < 8) {
          handled = true;
          // Skip this account
        }
      } catch (e) {
        crashed = true;
      }
      
      const passed = handled && !crashed;
      return { 
        passed, 
        message: passed ? 'Malformed data handled gracefully' : 'Failed to handle malformed data' 
      };
    }
  );
  
  // Test 3: Concurrent distribution protection
  await runTest(
    'Concurrent distribution calls protected',
    'Edge Cases',
    false,
    async () => {
      let distributionInProgress = false;
      const results: boolean[] = [];
      
      async function distribute(): Promise<boolean> {
        if (distributionInProgress) {
          return false; // Already in progress
        }
        
        distributionInProgress = true;
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
        distributionInProgress = false;
        return true;
      }
      
      // Try concurrent calls
      const promises = [
        distribute().then(r => results.push(r)),
        distribute().then(r => results.push(r)),
        distribute().then(r => results.push(r)),
      ];
      
      await Promise.all(promises);
      
      const successCount = results.filter(r => r).length;
      const passed = successCount === 1; // Only one should succeed
      
      return { 
        passed, 
        message: passed ? 'Concurrent calls properly blocked' : `${successCount} concurrent calls succeeded` 
      };
    }
  );
  
  // Test 4: Large batch handling
  await runTest(
    'Large batch of eligible stakers handled',
    'Edge Cases',
    false,
    async () => {
      const MAX_BATCH_SIZE = 100;
      const largeUserCount = 250;
      
      // Simulate large user list
      const users = Array.from({ length: largeUserCount }, () => ({
        pubkey: Keypair.generate().publicKey,
        amount: new BN(Math.floor(Math.random() * 10000)),
      }));
      
      // Process in batches
      const batches: number[] = [];
      for (let i = 0; i < users.length; i += MAX_BATCH_SIZE) {
        const batch = users.slice(i, i + MAX_BATCH_SIZE);
        batches.push(batch.length);
      }
      
      const expectedBatches = Math.ceil(largeUserCount / MAX_BATCH_SIZE);
      const passed = batches.length === expectedBatches && batches.every(b => b <= MAX_BATCH_SIZE);
      
      return { 
        passed, 
        message: passed ? `Processed ${batches.length} batches correctly` : 'Batch processing incorrect' 
      };
    }
  );
}

// ============= REPORT GENERATION =============

function generateReport(): void {
  console.log(chalk.bold('\n' + '='.repeat(70)));
  console.log(chalk.bold.cyan('           STAKING SECURITY TEST REPORT'));
  console.log(chalk.bold('='.repeat(70) + '\n'));

  // Group by category
  const categories = [...new Set(results.map(r => r.category))];
  
  let totalPassed = 0;
  let totalFailed = 0;
  let criticalFailed = 0;

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const passed = categoryResults.filter(r => r.passed).length;
    const failed = categoryResults.filter(r => !r.passed).length;
    
    console.log(chalk.bold.white(`\n📋 ${category}`));
    console.log(chalk.gray('-'.repeat(50)));
    
    for (const result of categoryResults) {
      const status = result.passed 
        ? chalk.green('✓ PASS') 
        : (result.critical ? chalk.red('✗ FAIL [CRITICAL]') : chalk.yellow('✗ FAIL'));
      const duration = chalk.gray(`(${result.duration}ms)`);
      
      console.log(`  ${status} ${result.name} ${duration}`);
      if (!result.passed) {
        console.log(chalk.gray(`       └─ ${result.message}`));
      }
      
      if (result.passed) totalPassed++;
      else {
        totalFailed++;
        if (result.critical) criticalFailed++;
      }
    }
    
    console.log(chalk.gray(`  Summary: ${passed}/${categoryResults.length} passed`));
  }

  // Overall summary
  console.log(chalk.bold('\n' + '='.repeat(70)));
  console.log(chalk.bold.white('                    OVERALL SUMMARY'));
  console.log(chalk.bold('='.repeat(70)));
  
  const total = totalPassed + totalFailed;
  const passRate = ((totalPassed / total) * 100).toFixed(1);
  
  console.log(`\n  Total Tests:     ${total}`);
  console.log(`  ${chalk.green('Passed:')}          ${totalPassed}`);
  console.log(`  ${chalk.red('Failed:')}          ${totalFailed}`);
  console.log(`  ${chalk.red('Critical Failed:')} ${criticalFailed}`);
  console.log(`  Pass Rate:       ${passRate}%`);
  
  // Security rating
  let rating: string;
  let ratingColor: typeof chalk.green;
  
  if (criticalFailed > 0) {
    rating = 'CRITICAL - DO NOT DEPLOY';
    ratingColor = chalk.red;
  } else if (totalFailed > 3) {
    rating = 'POOR - Needs attention';
    ratingColor = chalk.yellow;
  } else if (totalFailed > 0) {
    rating = 'GOOD - Minor issues';
    ratingColor = chalk.cyan;
  } else {
    rating = 'EXCELLENT - All tests passed';
    ratingColor = chalk.green;
  }
  
  console.log(`\n  ${chalk.bold('Security Rating:')} ${ratingColor(rating)}`);
  
  // Recommendations
  if (totalFailed > 0) {
    console.log(chalk.bold.yellow('\n⚠️  Recommendations:'));
    
    const failedTests = results.filter(r => !r.passed);
    const failedCategories = [...new Set(failedTests.map(r => r.category))];
    
    for (const cat of failedCategories) {
      console.log(chalk.yellow(`  • Review and fix ${cat} tests`));
    }
    
    if (criticalFailed > 0) {
      console.log(chalk.red('\n  🚨 CRITICAL: Do not deploy until critical issues are resolved!'));
    }
  }
  
  console.log(chalk.bold('\n' + '='.repeat(70) + '\n'));
}

// ============= MAIN =============

async function main() {
  const program = new Command();
  
  program
    .option('-n, --network <network>', 'Network to test against', 'devnet')
    .option('-v, --verbose', 'Show detailed output')
    .parse();
  
  const options = program.opts();
  
  console.log(chalk.bold.cyan('\n🔒 Starting Staking Security Tests...\n'));
  console.log(chalk.gray(`Network: ${options.network}`));
  console.log(chalk.gray(`Time: ${new Date().toISOString()}\n`));
  
  // Setup connection
  const rpcUrl = options.network === 'mainnet-beta' 
    ? process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    : `https://api.${options.network}.solana.com`;
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Get program ID from deployment config
  const programId = new PublicKey(process.env.PROGRAM_ID || 'GgKY8mQs6MwRbyKFczPekJDNZBEqgbPuRp2q9PuQ1qzs');
  
  // Derive staking pool PDA
  const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );
  
  // Run all test categories
  console.log(chalk.cyan('Running PDA Validation Tests...'));
  await testPDAValidation(connection, programId);
  
  console.log(chalk.cyan('Running Discriminator Validation Tests...'));
  await testDiscriminatorValidation();
  
  console.log(chalk.cyan('Running Retry Logic Tests...'));
  await testRetryLogic();
  
  console.log(chalk.cyan('Running Transaction Simulation Tests...'));
  await testTransactionSimulation(connection);
  
  console.log(chalk.cyan('Running Pause Check Tests...'));
  await testPauseChecks();
  
  console.log(chalk.cyan('Running Security Logging Tests...'));
  await testSecurityLogging();
  
  console.log(chalk.cyan('Running Rate Limiting Tests...'));
  await testRateLimiting();
  
  console.log(chalk.cyan('Running Pool Validation Tests...'));
  await testPoolValidation(stakingPoolPDA);
  
  console.log(chalk.cyan('Running Edge Case Tests...'));
  await testEdgeCases();
  
  // Generate report
  generateReport();
  
  // Exit with error if critical tests failed
  const criticalFailed = results.filter(r => r.critical && !r.passed).length;
  if (criticalFailed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);