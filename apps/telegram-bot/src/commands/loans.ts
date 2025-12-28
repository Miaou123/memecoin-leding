import { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';
import { apiClient } from '../utils/api.js';
import { formatLoanMessage, formatWalletAddress } from '../utils/formatters.js';

export async function handleLoans(ctx: BotContext) {
  const telegramId = ctx.from?.id.toString();
  
  if (!telegramId) {
    await ctx.reply('❌ Unable to get your Telegram ID.');
    return;
  }
  
  try {
    // Get user by Telegram ID
    const user = await apiClient.getUserByTelegramId(telegramId);
    
    if (!user?.walletAddress) {
      const message = `
❌ <b>Wallet Not Linked</b>

You need to link your Solana wallet first to view your loans.

Use <code>/link YOUR_WALLET_ADDRESS</code> to get started.
      `.trim();
      
      await ctx.reply(message);
      return;
    }
    
    // Get user's loans
    const loans = await apiClient.getUserLoans(user.walletAddress);
    
    if (!loans || loans.length === 0) {
      const message = `
📊 <b>Your Loans</b>

You don't have any loans yet.

Visit the <a href="${process.env.WEB_APP_URL || 'https://app.memecoin-lending.com'}">web app</a> to create your first loan!
      `.trim();
      
      await ctx.reply(message);
      return;
    }
    
    // Group loans by status
    const activeLoans = loans.filter(loan => loan.status === 'active');
    const pastLoans = loans.filter(loan => loan.status !== 'active');
    
    let message = `📊 <b>Your Loans</b>\n\n`;
    
    // Active loans
    if (activeLoans.length > 0) {
      message += `🟢 <b>Active Loans (${activeLoans.length})</b>\n\n`;
      
      for (let i = 0; i < Math.min(activeLoans.length, 5); i++) {
        const loan = activeLoans[i];
        message += formatLoanMessage(loan, i + 1) + '\n\n';
      }
      
      if (activeLoans.length > 5) {
        message += `<i>... and ${activeLoans.length - 5} more active loans</i>\n\n`;
      }
    }
    
    // Past loans summary
    if (pastLoans.length > 0) {
      const repaidCount = pastLoans.filter(l => l.status === 'repaid').length;
      const liquidatedCount = pastLoans.filter(l => l.status.includes('liquidated')).length;
      
      message += `📈 <b>Loan History</b>\n`;
      message += `✅ Repaid: ${repaidCount}\n`;
      message += `❌ Liquidated: ${liquidatedCount}\n\n`;
    }
    
    // Create inline keyboard for loan details
    const keyboard = new InlineKeyboard();
    
    activeLoans.slice(0, 3).forEach((loan, index) => {
      keyboard.text(`Loan ${index + 1}`, `loan:${loan.pubkey}`);
      if (index % 2 === 1) keyboard.row();
    });
    
    if (activeLoans.length % 2 === 1 && activeLoans.length <= 3) {
      keyboard.row();
    }
    
    keyboard.text('🌐 View All', 'view_all_loans')
      .text('🔄 Refresh', 'refresh_loans');
    
    await ctx.reply(message, {
      reply_markup: keyboard,
    });
    
  } catch (error: any) {
    console.error('Error fetching loans:', error);
    
    await ctx.reply('❌ Failed to fetch your loans. Please try again later.');
  }
}