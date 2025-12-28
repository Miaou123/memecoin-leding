import { UserStats, NotificationPreferences } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';

class UserService {
  async getUserStats(wallet: string): Promise<UserStats> {
    const [totalLoans, activeLoans, aggregates] = await Promise.all([
      prisma.loan.count({
        where: { borrower: wallet },
      }),
      prisma.loan.count({
        where: { 
          borrower: wallet,
          status: 'active',
        },
      }),
      prisma.loan.aggregate({
        where: { borrower: wallet },
        _sum: {
          solBorrowed: true,
        },
        _count: {
          liquidatedAt: true,
        },
      }),
    ]);
    
    // Calculate total repaid (for repaid loans)
    const repaidLoans = await prisma.loan.findMany({
      where: {
        borrower: wallet,
        status: 'repaid',
      },
      select: {
        solBorrowed: true,
        interestRateBps: true,
        createdAt: true,
        repaidAt: true,
      },
    });
    
    let totalRepaid = '0';
    let totalInterestPaid = '0';
    
    for (const loan of repaidLoans) {
      const principal = BigInt(loan.solBorrowed);
      const duration = loan.repaidAt!.getTime() - loan.createdAt.getTime();
      const durationInSeconds = Math.floor(duration / 1000);
      const annualSeconds = 365 * 24 * 60 * 60;
      
      const interest = (principal * BigInt(loan.interestRateBps) * BigInt(durationInSeconds)) / 
        (BigInt(10000) * BigInt(annualSeconds));
      
      totalRepaid = (BigInt(totalRepaid) + principal + interest).toString();
      totalInterestPaid = (BigInt(totalInterestPaid) + interest).toString();
    }
    
    return {
      wallet,
      totalLoans,
      activeLoans,
      totalBorrowed: aggregates._sum.solBorrowed || '0',
      totalRepaid,
      totalInterestPaid,
      liquidations: aggregates._count.liquidatedAt || 0,
    };
  }
  
  async getNotificationPreferences(wallet: string): Promise<NotificationPreferences> {
    // Ensure user exists
    await this.ensureUserExists(wallet);
    
    const user = await prisma.user.findUnique({
      where: { id: wallet },
      include: { notificationPrefs: true },
    });
    
    const prefs = user?.notificationPrefs;
    
    return {
      loanCreated: prefs?.loanCreated ?? true,
      loanDueSoon: prefs?.loanDueSoon ?? true,
      loanLiquidated: prefs?.loanLiquidated ?? true,
      priceAlerts: prefs?.priceAlerts ?? true,
    };
  }
  
  async updateNotificationPreferences(
    wallet: string,
    updates: Partial<NotificationPreferences & { priceThresholdPct?: number }>
  ): Promise<NotificationPreferences> {
    // Ensure user exists
    await this.ensureUserExists(wallet);
    
    const user = await prisma.user.findUnique({
      where: { id: wallet },
    });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Upsert notification preferences
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId: wallet },
      create: {
        userId: wallet,
        ...updates,
      },
      update: updates,
    });
    
    return {
      loanCreated: prefs.loanCreated,
      loanDueSoon: prefs.loanDueSoon,
      loanLiquidated: prefs.loanLiquidated,
      priceAlerts: prefs.priceAlerts,
    };
  }
  
  async linkTelegramAccount(
    wallet: string,
    telegramId: string,
    telegramUsername?: string
  ): Promise<void> {
    // Check if telegram ID is already linked to another wallet
    const existingUser = await prisma.user.findUnique({
      where: { telegramId },
    });
    
    if (existingUser && existingUser.id !== wallet) {
      throw new Error('Telegram account already linked to another wallet');
    }
    
    // Update user
    await prisma.user.upsert({
      where: { id: wallet },
      create: {
        id: wallet,
        telegramId,
        telegramUsername,
      },
      update: {
        telegramId,
        telegramUsername,
      },
    });
  }
  
  async unlinkTelegramAccount(wallet: string): Promise<void> {
    await prisma.user.update({
      where: { id: wallet },
      data: {
        telegramId: null,
        telegramUsername: null,
      },
    });
  }
  
  async getUserByTelegramId(telegramId: string): Promise<any> {
    return prisma.user.findUnique({
      where: { telegramId },
    });
  }
  
  private async ensureUserExists(wallet: string): Promise<void> {
    await prisma.user.upsert({
      where: { id: wallet },
      create: { id: wallet },
      update: {},
    });
  }
}

export const userService = new UserService();