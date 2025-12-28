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
    return app.fetch(req, { 
      env: process.env,
    }).then(response => {
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
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

// Start server
const port = parseInt(process.env.PORT || '3001');
server.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`🔌 WebSocket server running on ws://localhost:${port}/ws`);
  
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