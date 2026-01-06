import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';

// Load environment variables
config();

// Security middleware
import { requestIdMiddleware, getRequestId } from './middleware/requestId.js';
import { trustedProxyMiddleware } from './middleware/trustedProxy.js';
import { apiSecurityHeaders } from './middleware/securityHeaders.js';
import { defaultBodyLimit } from './middleware/bodyLimit.js';
import { csrfProtection, csrfTokenEndpoint } from './middleware/csrf.js';

// Import routers
import { loansRouter } from './api/loans.js';
import { tokensRouter } from './api/tokens.js';
import { protocolRouter } from './api/protocol.js';
import { userRouter } from './api/user.js';
import { loanPrepareRouter } from './api/loan-prepare.js';
import { monitoringRouter } from './api/monitoring.js';
import { adminRouter } from './api/admin.js';
import { healthRouter } from './api/health.js';
import pricesRouter from './routes/prices.js';
import adminWhitelistRouter from './routes/admin/whitelist.js';
import adminFeesRouter, { setFeeClaimerService } from './routes/admin/fees.js';
import { stakingRoutes } from './routes/staking.js';
import { securityRoutes } from './routes/admin/security.routes.js';
import { testAuthRouter } from './api/test-auth.js';
import verificationRequestRouter from './routes/verification-request.js';
import telegramWebhookRouter from './routes/telegram-webhook.js';

// Import services
import { initializeJobs } from './jobs/index.js';
import { initializeWebSocket } from './websocket/index.js';
import { errorHandler } from './middleware/error.js';
import { prisma } from './db/client.js';
import { initializeFastPriceMonitor, fastPriceMonitor } from './services/fast-price-monitor.js';
import { loanService } from './services/loan.service.js';
import { distributionCrankService } from './services/distribution-crank.service.js';
import { FeeClaimerService } from './services/fee-claimer.service.js';
import { treasuryMonitor } from './services/treasury-monitor.service.js';
import { treasuryHealthService } from './services/treasury-health.service.js';
import { validateMainnetConfig, getNetworkConfig, isMainnet } from './config/network.js';
import { programMonitor } from './services/program-monitor.service.js';
import { Connection, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { PROGRAM_ID } from '@memecoin-lending/config';
import fs from 'fs';
import path from 'path';
import { getAdminKeypair } from './config/keys.js';
import { getTreasuryPda, getRewardVaultPda } from './config/deployment.js';

// Validate configuration on startup
const networkConfig = getNetworkConfig();
console.log(`🌐 Network: ${networkConfig.network}`);
console.log(`📍 RPC: ${networkConfig.rpcUrl}`);
console.log(`📦 Program: ${networkConfig.programId}`);

if (isMainnet()) {
  validateMainnetConfig();
  console.log('🚀 Running in MAINNET mode');
} else {
  console.log('🧪 Running in DEVNET mode');
}

// Create Hono app
const app = new Hono();

// Global service instance
let feeClaimerService: FeeClaimerService | null = null;

// CORS Configuration
const getAllowedOrigins = (): string[] => {
  if (process.env.CORS_ORIGIN) {
    return process.env.CORS_ORIGIN.split(',').map(o => o.trim());
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: CORS_ORIGIN must be set in production');
    process.exit(1);
  }
  // Only allow these in development
  return ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];
};

// ============================================
// MIDDLEWARE ORDER MATTERS - Apply in this order:
// ============================================

// 0. Request ID (must be first for logging)
app.use('*', requestIdMiddleware);

// 1. Trusted proxy (must be first to get correct client IP)
app.use('*', trustedProxyMiddleware);

// 2. Request logging
app.use('*', logger());

// 3. Body size limits (before parsing)
app.use('*', defaultBodyLimit);

// 4. Security headers
app.use('*', apiSecurityHeaders);

// 5. CORS
app.use('*', cors({
  origin: getAllowedOrigins(),
  credentials: true,
}));

// 6. CSRF protection (for mutation routes)
app.use('/api/loans/*', csrfProtection);
app.use('/api/admin/*', csrfProtection);
app.use('/api/user/*', csrfProtection);

// 7. CSRF token endpoint
app.get('/api/csrf-token', csrfTokenEndpoint);

// Health endpoints provided by healthRouter below

// API routes
app.route('/api/loans', loansRouter);
app.route('/api/loan', loanPrepareRouter);
app.route('/api/monitoring', monitoringRouter);
app.route('/api/tokens', tokensRouter);
app.route('/api/protocol', protocolRouter);
app.route('/api/user', userRouter);
app.route('/api/prices', pricesRouter);
app.route('/api/staking', stakingRoutes);
app.route('/api/test-auth', testAuthRouter);

// Admin routes - API key based
app.route('/api/admin', adminRouter);
app.route('/api/admin/fees', adminFeesRouter);

// Admin routes - Signature based (wallet authentication)
app.route('/api/admin/whitelist', adminWhitelistRouter);
app.route('/api/admin/security', securityRoutes);

// Verification requests (requires auth)
app.route('/api/verification-request', verificationRequestRouter);

// Telegram webhook
app.route('/telegram/webhook', telegramWebhookRouter);

// Health routes
app.route('/', healthRouter);  // /health, /ready, /metrics at root

// Error handler
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
  return c.json({ 
    success: false,
    error: 'Not Found',
    message: `Route ${c.req.method} ${c.req.path} not found`
  }, 404);
});

// Environment validation
const validateEnvironment = () => {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!process.env.JUPITER_API_KEY) {
    warnings.push('⚠️  JUPITER_API_KEY not set - using public endpoints (rate limited)');
  }

  if (!process.env.DATABASE_URL) {
    errors.push('❌ DATABASE_URL is required');
  }

  if (!process.env.REDIS_URL) {
    warnings.push('⚠️  REDIS_URL not set - background jobs may not work properly');
  }
  
  if (process.env.ADMIN_API_KEY) {
    const key = process.env.ADMIN_API_KEY;
    if (key.length < 32) {
      if (process.env.NODE_ENV === 'production') {
        errors.push('❌ ADMIN_API_KEY must be at least 32 characters in production');
      } else {
        warnings.push('⚠️  ADMIN_API_KEY should be at least 32 characters');
      }
    }
    if (process.env.NODE_ENV === 'production' && !/[A-Z].*[0-9]|[0-9].*[A-Z]/.test(key)) {
      warnings.push('⚠️  ADMIN_API_KEY should contain both uppercase letters and numbers');
    }
  } else if (process.env.NODE_ENV === 'production') {
    errors.push('❌ ADMIN_API_KEY is required in production');
  } else {
    warnings.push('⚠️  ADMIN_API_KEY not set - admin endpoints will not work');
  }
  
  // Fee claimer now uses hardcoded keypair path - no environment variables needed

  if (warnings.length > 0) {
    console.log('\n🔶 Environment Warnings:');
    warnings.forEach(warning => console.log(`  ${warning}`));
  }

  if (errors.length > 0) {
    console.log('\n🔴 Environment Errors:');
    errors.forEach(error => console.log(`  ${error}`));
    process.exit(1);
  }

  if (warnings.length === 0 && errors.length === 0) {
    console.log('✅ Environment configuration looks good');
  }
};

validateEnvironment();

// Initialize fee claimer service
async function initializeFeeClaimerService() {
  const enabled = process.env.ENABLE_FEE_CLAIMER !== 'false';
  
  if (!enabled) {
    console.log('💰 Fee claimer service disabled');
    return;
  }
  
  try {
    // Load admin keypair from centralized loader
    const adminKeypair = getAdminKeypair();
    console.log(`🔑 Fee claimer admin wallet: ${adminKeypair.publicKey.toString()}`);
    
    // Initialize connection and provider
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    const provider = new AnchorProvider(
      connection,
      new Wallet(adminKeypair),
      { commitment: 'confirmed' }
    );
    
    // Load IDL
    const idlPaths = [
      process.env.IDL_PATH,
      './target/idl/memecoin_lending.json',
      '../../target/idl/memecoin_lending.json',
      '../../../target/idl/memecoin_lending.json',
    ].filter(Boolean);
    
    let idl: Idl | null = null;
    for (const p of idlPaths) {
      if (p && fs.existsSync(p)) {
        idl = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      }
    }
    
    if (!idl) {
      console.warn('⚠️ IDL file not found - fee claimer disabled');
      return;
    }
    
    // Create program
    const program = new Program(idl, provider);
    
    // Parse configuration
    const minClaimThreshold = parseFloat(process.env.MIN_FEE_CLAIM_THRESHOLD || '0.01') * 1e9; // Convert to lamports
    const intervalMs = parseInt(process.env.FEE_CLAIM_INTERVAL_MS || '300000'); // Default 5 minutes
    
    // Create service
    feeClaimerService = new FeeClaimerService(connection, adminKeypair, program, {
      minClaimThreshold,
      intervalMs,
      enabled: true,
    });
    
    // Inject into routes
    setFeeClaimerService(feeClaimerService);
    
    // Check wallet balance
    const balance = await connection.getBalance(adminKeypair.publicKey);
    console.log(`💰 Fee claimer wallet balance: ${(balance / 1e9).toFixed(4)} SOL`);
    
    if (balance < 0.01 * 1e9) {
      console.warn('⚠️ Fee claimer wallet has low balance - may fail to pay transaction fees');
    }
    
    // Start auto-claiming
    feeClaimerService.startAutoClaim();
    console.log('✅ Fee claimer service initialized and running');
    
  } catch (error: any) {
    console.error('❌ Failed to initialize fee claimer:', error.message);
  }
}

// Start server
const port = parseInt(process.env.PORT || '3002');

const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 Server running on http://localhost:${info.port}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${info.port}/ws`);
  
  if (process.env.JUPITER_API_KEY) {
    import('./services/price.js').then(({ priceService }) => {
      priceService.testJupiterConnection().then((result: { working: boolean; latency: number }) => {
        if (result.working) {
          console.log(`✅ Jupiter price source connection successful (${result.latency}ms)`);
        } else {
          console.log(`❌ Jupiter price source connection failed`);
        }
      }).catch((error: any) => {
        console.log('⚠️  Could not test Jupiter API connection:', error.message);
      });
    });
  }
  
  // ════════════════════════════════════════════════════════════
  // Initialize Fast Price Monitor (1-second polling)
  // ════════════════════════════════════════════════════════════
  console.log('🚀 Starting price monitor...');

  try {
    initializeFastPriceMonitor(loanService).then(() => {
      const status = fastPriceMonitor.getStatus();
      console.log('✅ Price monitor running');
      console.log(`   Poll interval: 5 seconds (dev mode)`);
      console.log(`   Tokens: ${status.tokensMonitored}`);
      console.log(`   Thresholds: ${status.totalThresholds}`);
    }).catch((error: any) => {
      console.error('⚠️ Price monitor failed:', error.message);
      console.log('   Liquidation job will still run as backup');
    });
    
  } catch (error: any) {
    console.error('⚠️ Price monitor failed:', error.message);
    console.log('   Liquidation job will still run as backup');
  }
  
  initializeJobs().then(() => {
    console.log('📋 Background jobs initialized');
  }).catch((error) => {
    console.error('Failed to initialize jobs:', error);
  });
  
  // Initialize distribution crank service
  distributionCrankService.initialize().then(() => {
    console.log('🏗️ Distribution crank service initialized');
  }).catch((error) => {
    console.error('Failed to initialize distribution crank:', error);
  });
  
  // Initialize fee claimer service
  initializeFeeClaimerService().then(() => {
    console.log('💰 Fee claimer service startup complete');
  }).catch((error) => {
    console.error('Failed to start fee claimer:', error);
  });
  
  // Initialize treasury monitor
  const deploymentTreasuryPda = getTreasuryPda()?.toBase58();
  const deploymentRewardVaultPda = getRewardVaultPda()?.toBase58();
  const treasuryPdaToUse = deploymentTreasuryPda || process.env.TREASURY_PDA;
  const rewardVaultPdaToUse = deploymentRewardVaultPda || process.env.REWARD_VAULT_PDA;
  
  if (treasuryPdaToUse && process.env.ENABLE_TREASURY_MONITORING !== 'false') {
    treasuryMonitor.initialize(
      treasuryPdaToUse,
      rewardVaultPdaToUse // Optional
    ).then(() => {
      console.log('🏦 Treasury monitor initialized and running');
    }).catch((error) => {
      console.error('Failed to initialize treasury monitor:', error);
    });
  } else {
    console.log('🏦 Treasury monitoring disabled (TREASURY_PDA not configured)');
  }
  
  // Initialize treasury health monitoring
  if (treasuryPdaToUse) {
    treasuryHealthService.initialize(treasuryPdaToUse).then(() => {
      console.log('🏦 Treasury health monitoring started');
    }).catch((error) => {
      console.error('Failed to initialize treasury health monitoring:', error.message);
    });
  } else {
    console.log('⚠️ TREASURY_PDA not set, treasury health monitoring disabled');
  }
  
  // Initialize program monitor for detecting direct access
  programMonitor.startMonitoring().then(() => {
    console.log('🔍 Program monitor started - detecting direct program access');
  }).catch((error) => {
    console.error('Failed to start program monitor:', error);
  });
});

// Initialize WebSocket - pass the server, it creates WebSocketServer internally
const wss = initializeWebSocket(server as any);

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);
  
  try {
    // Stop fee claimer if running
    if (feeClaimerService) {
      console.log('Stopping fee claimer service...');
      feeClaimerService.stopAutoClaim();
    }
    
    // Stop treasury monitor
    console.log('Stopping treasury monitor...');
    treasuryMonitor.stop();
    
    // Stop treasury health service
    treasuryHealthService.stop();
    
    // Stop program monitor
    console.log('Stopping program monitor...');
    programMonitor.stopMonitoring();
    
    await fastPriceMonitor.shutdown();
    wss.close();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server, wss };