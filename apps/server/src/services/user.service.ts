import { UserStats, NotificationPreferences } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';

class UserService {
  async getUserStats(wallet: string): Promise<UserStats> {
    const [totalLoans, activeLoans, allLoans, liquidationCount] = await Promise.all([
      prisma.loan.count({
        where: { borrower: wallet },
      }),
      prisma.loan.count({
        where: { 
          borrower: wallet,
          status: 'active',
        },
      }),
      prisma.loan.findMany({
        where: { borrower: wallet },
        select: {
          solBorrowed: true,
          status: true,
          interestRateBps: true,
          createdAt: true,
          repaidAt: true,
          liquidatedAt: true,
        },
      }),
      prisma.loan.count({
        where: {
          borrower: wallet,
          liquidatedAt: { not: null },
        },
      }),
    ]);
    
    // Calculate totals manually using BigInt
    let totalBorrowed = BigInt(0);
    let totalRepaid = BigInt(0);
    let totalInterestPaid = BigInt(0);
    
    for (const loan of allLoans) {
      const principal = BigInt(loan.solBorrowed);
      totalBorrowed += principal;
      
      // For repaid loans, calculate total repayment with interest
      if (loan.status === 'repaid' && loan.repaidAt) {
        const duration = loan.repaidAt.getTime() - loan.createdAt.getTime();
        const durationInSeconds = Math.floor(duration / 1000);
        const annualSeconds = 365 * 24 * 60 * 60;
        
        const interest = (principal * BigInt(loan.interestRateBps) * BigInt(durationInSeconds)) / 
          (BigInt(10000) * BigInt(annualSeconds));
        
        totalRepaid += principal + interest;
        totalInterestPaid += interest;
      }
    }
    
    return {
      wallet,
      totalLoans,
      activeLoans,
      totalBorrowed: totalBorrowed.toString(),
      totalRepaid: totalRepaid.toString(),
      totalInterestPaid: totalInterestPaid.toString(),
      liquidations: liquidationCount,
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