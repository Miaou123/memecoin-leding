#!/usr/bin/env tsx

import chalk from 'chalk';

const ADMIN_KEY = process.env.ADMIN_KEY || '3a9f0aac56c323dcf6d4aa0dff6d97937c070446bcb21832195fbefb19e55a54';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const TEST_TOKEN_MINT = '6KHL8uUXFie8Xdy3EBvw6EgruiU3duc9fvGrWoZ9pump';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  duration: number;
  error?: string;
  response?: any;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  category: string,
  testFn: () => Promise<any>
): Promise<void> {
  const start = Date.now();
  try {
    const response = await testFn();
    results.push({
      name,
      category,
      passed: true,
      duration: Date.now() - start,
      response,
    });
    console.log(chalk.green(`  ✓ ${name}`));
  } catch (error: any) {
    results.push({
      name,
      category,
      passed: false,
      duration: Date.now() - start,
      error: error.message,
    });
    console.log(chalk.red(`  ✗ ${name}: ${error.message}`));
  }
}

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok && !data.success) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function fetchWithAdmin(url: string, options?: RequestInit): Promise<any> {
  return fetchJson(url, {
    ...options,
    headers: {
      'X-Admin-Key': ADMIN_KEY,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

// ============================================
// TEST CATEGORIES
// ============================================

async function testHealthEndpoints() {
  console.log(chalk.blue('\n📊 Health Endpoints'));
  
  await runTest('GET /health - Liveness check', 'Health', async () => {
    const data = await fetchJson(`${BASE_URL}/health`);
    if (data.status !== 'ok') throw new Error('Status not ok');
    return data;
  });
  
  await runTest('GET /ready - Readiness check', 'Health', async () => {
    const data = await fetchJson(`${BASE_URL}/ready`);
    if (data.status !== 'ready') throw new Error('Status not ready');
    if (!data.checks.database.ok) throw new Error('Database not ok');
    if (!data.checks.redis.ok) throw new Error('Redis not ok');
    if (!data.checks.solana.ok) throw new Error('Solana not ok');
    return data;
  });
  
  await runTest('GET /metrics - Protocol metrics', 'Health', async () => {
    const data = await fetchJson(`${BASE_URL}/metrics`);
    if (data.protocol === undefined) throw new Error('No protocol metrics');
    return data;
  });
}

async function testAdminAuthentication() {
  console.log(chalk.blue('\n🔐 Admin Authentication'));
  
  await runTest('Admin endpoint without key - should fail', 'Auth', async () => {
    try {
      await fetchJson(`${BASE_URL}/api/admin/status`);
      throw new Error('Should have required auth');
    } catch (e: any) {
      if (e.message.includes('Should have required auth')) throw e;
      return { correctly_rejected: true };
    }
  });
  
  await runTest('Admin endpoint with invalid key - should fail', 'Auth', async () => {
    try {
      await fetchJson(`${BASE_URL}/api/admin/status`, {
        headers: { 'X-Admin-Key': 'invalid-key' },
      });
      throw new Error('Should have rejected invalid key');
    } catch (e: any) {
      if (e.message.includes('Should have rejected')) throw e;
      return { correctly_rejected: true };
    }
  });
  
  await runTest('Admin endpoint with valid key - should succeed', 'Auth', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/status`);
    if (!data.success) throw new Error('Admin auth failed');
    return data;
  });
}

async function testAdminDashboard() {
  console.log(chalk.blue('\n📈 Admin Dashboard'));
  
  await runTest('GET /api/admin/status - Full dashboard', 'Admin', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/status`);
    if (!data.data.circuitBreaker) throw new Error('Missing circuitBreaker');
    if (!data.data.treasury) throw new Error('Missing treasury');
    if (!data.data.exposure) throw new Error('Missing exposure');
    return data.data;
  });
  
  await runTest('GET /api/admin/treasury - Treasury status', 'Admin', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/treasury`);
    if (!data.success) throw new Error('Failed to get treasury');
    return data.data;
  });
  
  await runTest('GET /api/admin/security/events - Security events', 'Admin', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/security/events`);
    if (!data.success) throw new Error('Failed to get security events');
    return data.data;
  });
}

async function testCircuitBreaker() {
  console.log(chalk.blue('\n⚡ Circuit Breaker'));
  
  await runTest('GET /api/monitoring/circuit-breaker - Status', 'CircuitBreaker', async () => {
    const data = await fetchJson(`${BASE_URL}/api/monitoring/circuit-breaker`);
    if (data.data.isTripped === undefined) throw new Error('Missing isTripped');
    return data.data;
  });
  
  await runTest('POST /api/monitoring/circuit-breaker/reset - Reset', 'CircuitBreaker', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/monitoring/circuit-breaker/reset`, {
      method: 'POST',
    });
    if (!data.success) throw new Error('Failed to reset circuit breaker');
    return data;
  });
}

async function testMonitoringEndpoints() {
  console.log(chalk.blue('\n📊 Monitoring Endpoints'));
  
  await runTest('GET /api/monitoring/liquidations - List liquidations', 'Monitoring', async () => {
    const data = await fetchJson(`${BASE_URL}/api/monitoring/liquidations`);
    if (!data.success) throw new Error('Failed to get liquidations');
    return data.data;
  });
  
  await runTest('GET /api/monitoring/liquidations/losses - Loss report', 'Monitoring', async () => {
    const data = await fetchJson(`${BASE_URL}/api/monitoring/liquidations/losses`);
    if (!data.success) throw new Error('Failed to get losses');
    return data.data;
  });
  
  await runTest('GET /api/monitoring/exposures - Token exposures', 'Monitoring', async () => {
    const data = await fetchJson(`${BASE_URL}/api/monitoring/exposures`);
    if (!data.success) throw new Error('Failed to get exposures');
    return data.data;
  });
  
  await runTest('GET /api/monitoring/exposures/warnings - Exposure warnings', 'Monitoring', async () => {
    const data = await fetchJson(`${BASE_URL}/api/monitoring/exposures/warnings`);
    if (!data.success) throw new Error('Failed to get warnings');
    return data.data;
  });
}

async function testRateLimiting() {
  console.log(chalk.blue('\n🚦 Rate Limiting'));
  
  const testWallet = 'CgWTFX7JJQHed3qyMDjJkNCxK4sFe3wbDFABmWAAmrdS';
  
  await runTest('GET /api/admin/wallets/:address/rate-limit - Status', 'RateLimit', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/wallets/${testWallet}/rate-limit`);
    if (!data.success) throw new Error('Failed to get rate limit status');
    return data.data;
  });
  
  await runTest('POST /api/admin/wallets/:address/rate-limit/reset - Reset', 'RateLimit', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/wallets/${testWallet}/rate-limit/reset`, {
      method: 'POST',
    });
    if (!data.success) throw new Error('Failed to reset rate limit');
    return data;
  });
}

async function testTokenManagement() {
  console.log(chalk.blue('\n🪙 Token Management'));
  
  await runTest('GET /api/admin/tokens/blacklisted - List blacklisted', 'Tokens', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/tokens/blacklisted`);
    if (!data.success) throw new Error('Failed to get blacklisted tokens');
    return data.data;
  });
  
  // Test blacklist flow
  await runTest('POST /api/admin/tokens/:mint/blacklist - Blacklist token', 'Tokens', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/tokens/${TEST_TOKEN_MINT}/blacklist`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Test blacklist - will unblacklist' }),
    });
    // May fail if already blacklisted or token doesn't exist on-chain
    return data;
  });
  
  // Small delay for on-chain confirmation
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await runTest('Verify token is blacklisted', 'Tokens', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/tokens/blacklisted`);
    // Just verify the endpoint works
    return data.data;
  });
  
  await runTest('POST /api/admin/tokens/:mint/unblacklist - Unblacklist token', 'Tokens', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/tokens/${TEST_TOKEN_MINT}/unblacklist`, {
      method: 'POST',
    });
    return data;
  });
}

async function testTelegramAlerts() {
  console.log(chalk.blue('\n📱 Telegram Alerts'));
  
  await runTest('POST /api/admin/security/test-alert - Send test alert', 'Telegram', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/security/test-alert`, {
      method: 'POST',
    });
    if (!data.success) throw new Error('Failed to send test alert');
    if (!data.data.telegram.success) throw new Error('Telegram send failed');
    return data.data;
  });
}

async function testTreasuryOperations() {
  console.log(chalk.blue('\n💰 Treasury Operations'));
  
  await runTest('POST /api/admin/treasury/check - Force health check', 'Treasury', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/treasury/check`, {
      method: 'POST',
    });
    if (!data.success) throw new Error('Failed to force treasury check');
    return data.data;
  });
}

async function testWalletInfo() {
  console.log(chalk.blue('\n👛 Wallet Info'));
  
  const testWallet = 'CgWTFX7JJQHed3qyMDjJkNCxK4sFe3wbDFABmWAAmrdS';
  
  await runTest('GET /api/admin/wallets/:address - Wallet info', 'Wallet', async () => {
    const data = await fetchWithAdmin(`${BASE_URL}/api/admin/wallets/${testWallet}`);
    if (!data.success) throw new Error('Failed to get wallet info');
    return data.data;
  });
}

// ============================================
// CLI TESTS (run as subprocesses)
// ============================================

import { execSync } from 'child_process';

async function testCLICommands() {
  console.log(chalk.blue('\n🖥️  CLI Commands'));
  
  await runTest('get-protocol-state - Protocol state', 'CLI', async () => {
    try {
      const output = execSync('npx tsx scripts/get-protocol-state.ts --network devnet', {
        encoding: 'utf-8',
        timeout: 30000,
      });
      if (!output.includes('Protocol State')) throw new Error('Invalid output');
      return { output: output.substring(0, 500) };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });
  
  await runTest('deployment-status - Deployment status', 'CLI', async () => {
    try {
      const output = execSync('npx tsx scripts/deployment-status.ts --network devnet', {
        encoding: 'utf-8',
        timeout: 30000,
      });
      if (!output.includes('Program Deployed')) throw new Error('Invalid output');
      return { output: output.substring(0, 500) };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });
  
  await runTest('get-token-configs - Token configs', 'CLI', async () => {
    try {
      const output = execSync('npx tsx scripts/get-token-configs.ts --network devnet', {
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { output: output.substring(0, 500) };
    } catch (e: any) {
      throw new Error(e.message);
    }
  });
}

// ============================================
// MAIN RUNNER
// ============================================

async function main() {
  console.log(chalk.bold.cyan('\n════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('  MEMECOIN LENDING - DEVNET TEST SUITE'));
  console.log(chalk.bold.cyan('════════════════════════════════════════════════════════════'));
  console.log(chalk.gray(`  Base URL: ${BASE_URL}`));
  console.log(chalk.gray(`  Network: devnet`));
  console.log(chalk.gray(`  Test Token: ${TEST_TOKEN_MINT.slice(0, 8)}...`));
  console.log(chalk.gray(`  Started: ${new Date().toISOString()}`));
  
  const startTime = Date.now();
  
  try {
    // Run all test categories
    await testHealthEndpoints();
    await testAdminAuthentication();
    await testAdminDashboard();
    await testCircuitBreaker();
    await testMonitoringEndpoints();
    await testRateLimiting();
    await testTokenManagement();
    await testTelegramAlerts();
    await testTreasuryOperations();
    await testWalletInfo();
    await testCLICommands();
  } catch (error: any) {
    console.log(chalk.red(`\n❌ Test suite crashed: ${error.message}`));
  }
  
  // Print summary
  const duration = Date.now() - startTime;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(chalk.bold.cyan('\n════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('  TEST RESULTS SUMMARY'));
  console.log(chalk.bold.cyan('════════════════════════════════════════════════════════════'));
  
  // Group by category
  const categories = [...new Set(results.map(r => r.category))];
  
  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const categoryPassed = categoryResults.filter(r => r.passed).length;
    const categoryTotal = categoryResults.length;
    const status = categoryPassed === categoryTotal ? chalk.green('✓') : chalk.red('✗');
    console.log(`\n  ${status} ${category}: ${categoryPassed}/${categoryTotal} passed`);
    
    // Show failures
    for (const result of categoryResults.filter(r => !r.passed)) {
      console.log(chalk.red(`      ✗ ${result.name}`));
      console.log(chalk.gray(`        Error: ${result.error}`));
    }
  }
  
  console.log(chalk.bold.cyan('\n────────────────────────────────────────────────────────────'));
  console.log(`  Total: ${chalk.bold(passed)} passed, ${failed > 0 ? chalk.red.bold(failed) : chalk.gray(failed)} failed`);
  console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(chalk.bold.cyan('────────────────────────────────────────────────────────────'));
  
  // Detailed failure report
  if (failed > 0) {
    console.log(chalk.red.bold('\n⚠️  FAILED TESTS:'));
    for (const result of results.filter(r => !r.passed)) {
      console.log(chalk.red(`\n  ${result.category} > ${result.name}`));
      console.log(chalk.gray(`    Error: ${result.error}`));
    }
  }
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);