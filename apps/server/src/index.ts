import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';

// Load environment variables
config();

// Import routers
import { loansRouter } from './api/loans.js';
import { tokensRouter } from './api/tokens.js';
import { protocolRouter } from './api/protocol.js';
import { userRouter } from './api/user.js';
import pricesRouter from './routes/prices.js';
import adminWhitelistRouter from './routes/admin/whitelist.js';
import adminFeesRouter, { setFeeClaimerService } from './routes/admin/fees.js';
import { stakingRoutes } from './routes/staking.js';
import { securityRoutes } from './routes/admin/security.routes.js';

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
import { Connection, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { PROGRAM_ID } from '@memecoin-lending/config';
import fs from 'fs';
import path from 'path';

// Create Hono app
const app = new Hono();

// Global service instance
let feeClaimerService: FeeClaimerService | null = null;

// Global middleware
app.use('/*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
}));
app.use('/*', logger());

// Health check endpoint
app.get('/health', async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    return c.json({ 
      status: 'error',
      message: 'Database connection failed'
    }, 503);
  }
});

// API routes
app.route('/api/loans', loansRouter);
app.route('/api/tokens', tokensRouter);
app.route('/api/protocol', protocolRouter);
app.route('/api/user', userRouter);
app.route('/api/prices', pricesRouter);
app.route('/api/staking', stakingRoutes);

// Admin routes
app.route('/api/admin/whitelist', adminWhitelistRouter);
app.route('/api/admin/fees', adminFeesRouter);
app.route('/api/admin/security', securityRoutes);

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
  
  if (!process.env.ADMIN_API_KEY) {
    warnings.push('⚠️  ADMIN_API_KEY not set - admin endpoints will not work');
  }
  
  const enableFeeClaimer = process.env.ENABLE_FEE_CLAIMER !== 'false';
  if (enableFeeClaimer) {
    if (!process.env.ADMIN_KEYPAIR_PATH && !process.env.ADMIN_PRIVATE_KEY) {
      warnings.push('⚠️  Neither ADMIN_KEYPAIR_PATH nor ADMIN_PRIVATE_KEY set - fee claimer disabled');
    }
  }

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
    // Load admin keypair
    let adminKeypair: Keypair;
    
    if (process.env.ADMIN_PRIVATE_KEY) {
      // Production: use base58 encoded private key
      const privateKeyBytes = Buffer.from(process.env.ADMIN_PRIVATE_KEY, 'base64');
      adminKeypair = Keypair.fromSecretKey(new Uint8Array(privateKeyBytes));
    } else if (process.env.ADMIN_KEYPAIR_PATH) {
      // Development: use keypair file
      const keypairPath = path.resolve(process.env.ADMIN_KEYPAIR_PATH);
      
      if (!fs.existsSync(keypairPath)) {
        console.warn(`⚠️ Admin keypair not found at ${keypairPath}`);
        return;
      }
      
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } else {
      console.warn('⚠️ No admin keypair configured - fee claimer disabled');
      return;
    }
    
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
  if (process.env.TREASURY_PDA && process.env.ENABLE_TREASURY_MONITORING !== 'false') {
    treasuryMonitor.initialize(
      process.env.TREASURY_PDA,
      process.env.REWARD_VAULT_PDA // Optional
    ).then(() => {
      console.log('🏦 Treasury monitor initialized and running');
    }).catch((error) => {
      console.error('Failed to initialize treasury monitor:', error);
    });
  } else {
    console.log('🏦 Treasury monitoring disabled (TREASURY_PDA not configured)');
  }
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