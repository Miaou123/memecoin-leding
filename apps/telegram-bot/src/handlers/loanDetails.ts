import { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';
import { apiClient } from '../utils/api.js';
import { formatLoanDetails } from '../utils/formatters.js';

export async function handleLoanDetails(ctx: BotContext) {
  const callbackData = ctx.callbackQuery?.data;
  
  if (!callbackData) return;
  
  const loanPubkey = callbackData.replace('loan:', '');
  
  try {
    await ctx.answerCallbackQuery('🔍 Loading loan details...');
    
    // Fetch loan details
    const loan = await apiClient.getLoan(loanPubkey);
    
    if (!loan) {
      await ctx.editMessageText('❌ Loan not found or has been removed.');
      return;
    }
    
    const message = formatLoanDetails(loan);
    
    const keyboard = new InlineKeyboard();
    
    // Add action buttons for active loans
    if (loan.status === 'active') {
      keyboard
        .text('💰 Repay', `repay:${loan.pubkey}`)
        .text('📊 Details', `details:${loan.pubkey}`)
        .row();
    }
    
    keyboard
      .text('🔄 Refresh', `loan:${loan.pubkey}`)
      .text('🌐 View on Explorer', `explorer:${loan.pubkey}`)
      .row()
      .text('🔙 Back to Loans', 'my_loans');
    
    await ctx.editMessageText(message, {
      reply_markup: keyboard,
    });
    
  } catch (error: any) {
    console.error('Error fetching loan details:', error);
    
    await ctx.answerCallbackQuery('❌ Failed to load loan details');
    
    try {
      await ctx.editMessageText('❌ Failed to load loan details. Please try again later.');
    } catch {
      // Ignore if we can't edit the message
    }
  }
}