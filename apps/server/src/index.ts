import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Load environment variables
config();

// Import routers
import { loansRouter } from './api/loans.js';
import { tokensRouter } from './api/tokens.js';
import { protocolRouter } from './api/protocol.js';
import { userRouter } from './api/user.js';
import pricesRouter from './routes/prices.js';

// Import services
import { initializeJobs } from './jobs/index.js';
import { initializeWebSocket } from './websocket/index.js';
import { errorHandler } from './middleware/error.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimiter } from './middleware/rateLimit.js';
import { prisma } from './db/client.js';

// Create Hono app
const app = new Hono();

// Global middleware
app.use('/*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));
app.use('/*', logger());

// Health check endpoint
app.get('/health', async (c) => {
  try {
    // Check database connection
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

// Create HTTP server
const server = createServer((req, res) => {
  // Handle regular HTTP requests with Hono
  if (!req.url?.startsWith('/ws')) {
    const result = app.fetch(req as any, { 
      env: process.env,
    });
    
    return Promise.resolve(result).then((response: any) => {
      res.statusCode = response.status;
      response.headers.forEach((value: any, key: any) => {
        res.setHeader(key, value);
      });
      response.body?.pipeTo(
        new WritableStream({
          write(chunk) {
            res.write(chunk);
          },
          close() {
            res.end();
          },
        })
      );
    });
  }
});

// Initialize WebSocket server
const wss = initializeWebSocket(server);

// Environment validation
const validateEnvironment = () => {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check Jupiter API key
  if (!process.env.JUPITER_API_KEY) {
    warnings.push('⚠️  JUPITER_API_KEY not set - using public endpoints (rate limited)');
    warnings.push('   Get your API key at: https://portal.jup.ag');
  }

  // Check database URL
  if (!process.env.DATABASE_URL) {
    errors.push('❌ DATABASE_URL is required');
  }

  // Check Redis URL
  if (!process.env.REDIS_URL) {
    warnings.push('⚠️  REDIS_URL not set - background jobs may not work properly');
  }

  // Print warnings
  if (warnings.length > 0) {
    console.log('\n🔶 Environment Warnings:');
    warnings.forEach(warning => console.log(`  ${warning}`));
  }

  // Print errors and exit if any
  if (errors.length > 0) {
    console.log('\n🔴 Environment Errors:');
    errors.forEach(error => console.log(`  ${error}`));
    console.log('\n💡 Copy .env.example to .env and configure your environment variables');
    process.exit(1);
  }

  if (warnings.length === 0 && errors.length === 0) {
    console.log('✅ Environment configuration looks good');
  }
};

// Validate environment before starting
validateEnvironment();

// Start server
const port = parseInt(process.env.PORT || '3001');
server.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${port}/ws`);
  
  // Test Jupiter API connection if API key is configured
  if (process.env.JUPITER_API_KEY) {
    import('./services/price.js').then(({ priceService }) => {
      priceService.testPriceSource().then((result: { working: boolean; source: string; latency: number }) => {
        if (result.working) {
          console.log(`✅ ${result.source} price source connection successful (${result.latency}ms)`);
        } else {
          console.log(`❌ ${result.source} price source connection failed`);
        }
      }).catch(error => {
        console.log('⚠️  Could not test Jupiter API connection:', error.message);
      });
    });
  }
  
  // Initialize background jobs
  initializeJobs().then(() => {
    console.log('📋 Background jobs initialized');
  }).catch((error) => {
    console.error('Failed to initialize jobs:', error);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  // Close WebSocket server
  wss.close();
  
  // Close HTTP server
  server.close();
  
  // Close database connection
  await prisma.$disconnect();
  
  process.exit(0);
});

export { app, server, wss };