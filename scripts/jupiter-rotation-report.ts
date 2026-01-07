#!/usr/bin/env tsx
/**
 * Generate Jupiter Multi-Key Rotation Test Report
 */

import * as fs from 'fs';
import * as path from 'path';

const SERVER_URL = 'http://localhost:3002';
const MINTS = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
];

async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function getJupiterHealth() {
  try {
    const response = await fetch(`${SERVER_URL}/api/price-status/jupiter-health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to get Jupiter health:', error);
    return null;
  }
}

async function makePriceRequests(count: number) {
  console.log(`Making ${count} price requests...`);
  const mintsQuery = MINTS.join(',');
  
  for (let i = 1; i <= count; i++) {
    try {
      await fetch(`${SERVER_URL}/api/prices?mints=${mintsQuery}`);
      process.stdout.write(`\r  Request ${i}/${count} complete`);
      await new Promise(r => setTimeout(r, 200)); // 200ms between requests
    } catch (error) {
      console.error(`\n  Request ${i} failed:`, error);
    }
  }
  console.log(''); // New line after progress
}

function analyzeConfiguration(): { total: number; withProxy: number; keys: string[] } {
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  
  try {
    envContent = fs.readFileSync(envPath, 'utf-8');
  } catch {
    console.warn('Could not read .env file');
    return { total: 0, withProxy: 0, keys: [] };
  }
  
  const keys: string[] = [];
  const proxies: Set<number> = new Set();
  
  // Find all JUPITER_API_KEYn entries
  const keyMatches = envContent.matchAll(/^JUPITER_API_KEY(\d+)=(.+)$/gm);
  for (const match of keyMatches) {
    const num = parseInt(match[1]);
    keys[num] = match[2].trim();
  }
  
  // Find all JUPITER_PROXYn entries
  const proxyMatches = envContent.matchAll(/^JUPITER_PROXY(\d+)=(.+)$/gm);
  for (const match of proxyMatches) {
    const num = parseInt(match[1]);
    const value = match[2].trim();
    if (value && value.startsWith('http')) {
      proxies.add(num);
    }
  }
  
  // Check legacy key
  const legacyMatch = envContent.match(/^JUPITER_API_KEY=(.+)$/m);
  if (legacyMatch && keys.length === 0) {
    keys[0] = legacyMatch[1].trim();
  }
  
  const totalKeys = keys.filter(k => k).length;
  const withProxy = Array.from(proxies).filter(n => keys[n]).length;
  
  return { total: totalKeys, withProxy, keys };
}

async function generateReport() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           JUPITER MULTI-KEY ROTATION TEST REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Check server
  const serverRunning = await checkServerHealth();
  if (!serverRunning) {
    console.log('❌ ERROR: Server is not running on port 3002!');
    console.log('   Please start the server first with: pnpm --filter @memecoin-lending/server dev');
    console.log('\n═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }
  
  // Analyze configuration
  const config = analyzeConfiguration();
  console.log('📊 CONFIGURATION');
  console.log(`   Total Keys: ${config.total}`);
  console.log(`   Keys with Proxy: ${config.withProxy}`);
  console.log(`   Keys Direct: ${config.total - config.withProxy}`);
  
  // Get initial health
  console.log('\n🔍 Getting initial health status...');
  const initialHealth = await getJupiterHealth();
  
  if (!initialHealth) {
    console.log('❌ ERROR: Could not get Jupiter health status');
    console.log('\n═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }
  
  const initialRequests = initialHealth.data.endpoints.reduce((sum: number, e: any) => sum + e.totalRequests, 0);
  console.log(`   Initial total requests: ${initialRequests}`);
  
  // Make test requests
  console.log('\n🚀 Running rotation test...');
  await makePriceRequests(15);
  
  // Wait a moment for any in-flight requests
  console.log('\n⏳ Waiting for requests to complete...');
  await new Promise(r => setTimeout(r, 2000));
  
  // Get final health
  console.log('\n📈 Getting final health status...');
  const finalHealth = await getJupiterHealth();
  
  if (!finalHealth) {
    console.log('❌ ERROR: Could not get final Jupiter health status');
    console.log('\n═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }
  
  // Analyze results
  console.log('\n📊 REQUEST DISTRIBUTION');
  const endpoints = finalHealth.data.endpoints;
  const finalRequests = endpoints.reduce((sum: number, e: any) => sum + e.totalRequests, 0);
  const newRequests = finalRequests - initialRequests;
  
  endpoints.forEach((endpoint: any) => {
    const initialEndpoint = initialHealth.data.endpoints.find((e: any) => e.id === endpoint.id);
    const requestsDiff = initialEndpoint ? endpoint.totalRequests - initialEndpoint.totalRequests : endpoint.totalRequests;
    const distribution = newRequests > 0 ? (requestsDiff / newRequests * 100).toFixed(1) : '0';
    
    console.log(`   Key ${endpoint.id} ${endpoint.hasProxy ? '(proxy)' : '(direct)'}:`);
    console.log(`     Requests: +${requestsDiff} (${distribution}% of new)`);
    console.log(`     Latency: ${endpoint.avgLatencyMs}ms`);
    console.log(`     Success: ${endpoint.successRate}`);
    console.log(`     Health: ${endpoint.healthy ? '✅' : '❌'}`);
  });
  
  console.log(`\n   Total new requests: ${newRequests}`);
  
  // Health summary
  console.log('\n🏥 HEALTH STATUS');
  console.log(`   Healthy: ${finalHealth.data.healthy}/${finalHealth.data.total}`);
  const totalFailures = endpoints.reduce((sum: number, e: any) => sum + e.totalFailures, 0);
  console.log(`   Total Failures: ${totalFailures}`);
  
  // Verdict
  console.log('\n');
  let verdict = 'UNKNOWN';
  let details = '';
  
  if (config.total === 0) {
    verdict = '❌ FAIL';
    details = 'No Jupiter API keys configured!';
  } else if (config.total === 1) {
    verdict = '⚠️ WARNING';
    details = 'Only 1 API key configured. Add more keys for rotation.';
  } else if (endpoints.every((e: any) => e.healthy)) {
    // Check if requests are distributed
    const minRequests = Math.min(...endpoints.map((e: any) => e.totalRequests));
    const maxRequests = Math.max(...endpoints.map((e: any) => e.totalRequests));
    const distribution = maxRequests > 0 ? minRequests / maxRequests : 0;
    
    if (distribution > 0.5) {
      verdict = '✅ PASS';
      details = `Rotation working correctly! Requests distributed across all ${config.total} keys.`;
    } else {
      verdict = '⚠️ PARTIAL';
      details = 'Requests not evenly distributed. Some endpoints may be failing intermittently.';
    }
  } else {
    verdict = '❌ FAIL';
    const unhealthy = endpoints.filter((e: any) => !e.healthy).length;
    details = `${unhealthy} endpoints are unhealthy!`;
  }
  
  console.log(`${verdict} - ${details}`);
  
  // Additional insights
  if (config.withProxy > 0) {
    const proxyEndpoints = endpoints.filter((e: any) => e.hasProxy);
    const avgProxyLatency = proxyEndpoints.reduce((sum: number, e: any) => sum + e.avgLatencyMs, 0) / proxyEndpoints.length;
    const directEndpoints = endpoints.filter((e: any) => !e.hasProxy);
    const avgDirectLatency = directEndpoints.reduce((sum: number, e: any) => sum + e.avgLatencyMs, 0) / directEndpoints.length;
    
    if (proxyEndpoints.length > 0 && directEndpoints.length > 0) {
      const overhead = avgProxyLatency - avgDirectLatency;
      console.log(`\n   Proxy latency overhead: ${overhead.toFixed(0)}ms`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
}

// Run the report
generateReport().catch((error) => {
  console.error('❌ Report generation failed:', error);
  process.exit(1);
});