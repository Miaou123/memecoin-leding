import { prisma } from '../db/client.js';
import { websocketService } from '../websocket/index.js';

interface CreateNotificationParams {
  userId: string;
  type: string;
  title: string;
  message: string;
  loanId?: string;
  data?: any;
}

class NotificationService {
  async createNotification(params: CreateNotificationParams): Promise<void> {
    // Create notification in database
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        loanId: params.loanId,
        data: params.data,
      },
    });
    
    // Check user preferences
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { notificationPrefs: true },
    });
    
    if (!user?.notificationsEnabled) {
      return;
    }
    
    // Check specific notification type preference
    const prefs = user.notificationPrefs;
    const shouldNotify = this.shouldSendNotification(params.type, prefs);
    
    if (!shouldNotify) {
      return;
    }
    
    // Send real-time notification via WebSocket
    websocketService.sendToUser(params.userId, 'notification', notification);
    
    // Queue Telegram notification if user has linked account
    if (user.telegramId) {
      await this.queueTelegramNotification(notification.id, user.telegramId);
    }
  }
  
  private shouldSendNotification(type: string, prefs: any): boolean {
    if (!prefs) return true; // Default to sending if no preferences
    
    switch (type) {
      case 'loan_created':
        return prefs.loanCreated;
      case 'loan_due_soon':
      case 'loan_due_urgent':
        return prefs.loanDueSoon;
      case 'loan_liquidated':
        return prefs.loanLiquidated;
      case 'price_alert':
        return prefs.priceAlerts;
      default:
        return true;
    }
  }
  
  private async queueTelegramNotification(
    notificationId: string,
    telegramId: string
  ): Promise<void> {
    // In a real implementation, this would add to a queue (e.g., BullMQ)
    // For now, we'll just mark it for sending
    await prisma.notification.update({
      where: { id: notificationId },
      data: { sentToTelegram: false }, // Will be processed by telegram bot
    });
  }
  
  async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }
  
  async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: { read: true },
    });
  }
  
  async checkLoanDueNotifications(): Promise<void> {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
    
    // Find loans due in 1 hour
    const loansDue1Hour = await prisma.loan.findMany({
      where: {
        status: 'active',
        dueAt: {
          gte: now,
          lte: oneHourFromNow,
        },
        notifications: {
          none: {
            type: 'loan_due_soon',
          },
        },
      },
    });
    
    // Find loans due in 15 minutes
    const loansDue15Min = await prisma.loan.findMany({
      where: {
        status: 'active',
        dueAt: {
          gte: now,
          lte: fifteenMinutesFromNow,
        },
        notifications: {
          none: {
            type: 'loan_due_urgent',
          },
        },
      },
    });
    
    // Send 1 hour notifications
    for (const loan of loansDue1Hour) {
      await this.createNotification({
        userId: loan.borrower,
        type: 'loan_due_soon',
        title: 'Loan Due Soon',
        message: 'Your loan is due in 1 hour. Please repay to avoid liquidation.',
        loanId: loan.id,
      });
    }
    
    // Send 15 minute notifications
    for (const loan of loansDue15Min) {
      await this.createNotification({
        userId: loan.borrower,
        type: 'loan_due_urgent',
        title: 'Urgent: Loan Due Soon',
        message: 'Your loan is due in 15 minutes! Repay immediately to avoid liquidation.',
        loanId: loan.id,
      });
    }
  }
}

export const notificationService = new NotificationService();