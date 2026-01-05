import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const testAuthRouter = new Hono();

// Test regular authentication
testAuthRouter.get('/regular', requireAuth, async (c) => {
  return c.json({
    success: true,
    message: 'Regular auth successful',
    user: c.user,
  });
});

// Test admin authentication
testAuthRouter.get('/admin', requireAdmin, async (c) => {
  return c.json({
    success: true,
    message: 'Admin auth successful',
    user: c.user,
  });
});

// Test no auth
testAuthRouter.get('/public', async (c) => {
  return c.json({
    success: true,
    message: 'Public endpoint',
  });
});