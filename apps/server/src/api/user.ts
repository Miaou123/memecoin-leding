import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { 
  ApiResponse, 
  UserStats, 
  NotificationPreferences 
} from '@memecoin-lending/types';
import { authMiddleware, requireAuth } from '../middleware/auth.js';
import { apiRateLimit } from '../middleware/rateLimit.js';
import { userService } from '../services/user.service.js';
import { prisma } from '../db/client.js';

const userRouter = new Hono();

// Apply middleware
userRouter.use('/*', authMiddleware);
userRouter.use('/*', apiRateLimit);

// Get user stats
userRouter.get('/:wallet/stats', async (c) => {
  const wallet = c.req.param('wallet');
  
  const stats = await userService.getUserStats(wallet);
  
  return c.json<ApiResponse<UserStats>>({
    success: true,
    data: stats,
  });
});

// Get user loan history
userRouter.get('/:wallet/history', async (c) => {
  const wallet = c.req.param('wallet');
  const query = c.req.query();
  
  const page = parseInt(query.page || '1');
  const pageSize = parseInt(query.pageSize || '20');
  
  const loans = await prisma.loan.findMany({
    where: { borrower: wallet },
    include: { token: true },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  
  const total = await prisma.loan.count({
    where: { borrower: wallet },
  });
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: {
      loans,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: page * pageSize < total,
      },
    },
  });
});

// Get user notifications
userRouter.get('/notifications', requireAuth, async (c) => {
  const user = c.user!;
  const query = c.req.query();
  
  const unreadOnly = query.unread === 'true';
  
  const notifications = await prisma.notification.findMany({
    where: {
      userId: user.wallet,
      ...(unreadOnly && { read: false }),
    },
    include: { loan: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  
  return c.json<ApiResponse<any>>({
    success: true,
    data: notifications,
  });
});

// Mark notification as read
userRouter.put(
  '/notifications/:id/read',
  requireAuth,
  async (c) => {
    const notificationId = c.req.param('id');
    const user = c.user!;
    
    const notification = await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: user.wallet,
      },
      data: { read: true },
    });
    
    return c.json<ApiResponse<{ message: string }>>({
      success: true,
      data: { message: 'Notification marked as read' },
    });
  }
);

// Get notification preferences
userRouter.get('/preferences/notifications', requireAuth, async (c) => {
  const user = c.user!;
  
  const prefs = await userService.getNotificationPreferences(user.wallet);
  
  return c.json<ApiResponse<NotificationPreferences>>({
    success: true,
    data: prefs,
  });
});

// Update notification preferences
const updatePreferencesSchema = z.object({
  loanCreated: z.boolean().optional(),
  loanDueSoon: z.boolean().optional(),
  loanLiquidated: z.boolean().optional(),
  priceAlerts: z.boolean().optional(),
  priceThresholdPct: z.number().min(1).max(50).optional(),
});

userRouter.put(
  '/preferences/notifications',
  requireAuth,
  zValidator('json', updatePreferencesSchema),
  async (c) => {
    const user = c.user!;
    const updates = c.req.valid('json');
    
    const prefs = await userService.updateNotificationPreferences(
      user.wallet,
      updates
    );
    
    return c.json<ApiResponse<NotificationPreferences>>({
      success: true,
      data: prefs,
    });
  }
);

// Link Telegram account
const linkTelegramSchema = z.object({
  telegramId: z.string(),
  telegramUsername: z.string().optional(),
});

userRouter.post(
  '/link-telegram',
  requireAuth,
  zValidator('json', linkTelegramSchema),
  async (c) => {
    const user = c.user!;
    const { telegramId, telegramUsername } = c.req.valid('json');
    
    try {
      await userService.linkTelegramAccount(
        user.wallet,
        telegramId,
        telegramUsername
      );
      
      return c.json<ApiResponse<{ message: string }>>({
        success: true,
        data: { message: 'Telegram account linked successfully' },
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Unlink Telegram account
userRouter.delete('/unlink-telegram', requireAuth, async (c) => {
  const user = c.user!;
  
  await userService.unlinkTelegramAccount(user.wallet);
  
  return c.json<ApiResponse<{ message: string }>>({
    success: true,
    data: { message: 'Telegram account unlinked successfully' },
  });
});

export { userRouter };