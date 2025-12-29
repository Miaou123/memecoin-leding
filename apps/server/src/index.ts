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
import { stakingRoutes } from './routes/staking.js';

// Import services
import { initializeJobs } from './jobs/index.js';
import { initializeWebSocket } from './websocket/index.js';
import { errorHandler } from './middleware/error.js';
import { prisma } from './db/client.js';

// Create Hono app
const app = new Hono();

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
  
  initializeJobs().then(() => {
    console.log('📋 Background jobs initialized');
  }).catch((error) => {
    console.error('Failed to initialize jobs:', error);
  });
});

// Initialize WebSocket - pass the server, it creates WebSocketServer internally
const wss = initializeWebSocket(server as any);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, server, wss };