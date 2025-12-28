import { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';
import { apiClient } from '../utils/api.js';

export async function handleAlerts(ctx: BotContext) {
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
🚨 <b>Alert Configuration</b>

You need to link your Solana wallet first to configure alerts.

Use <code>/link YOUR_WALLET_ADDRESS</code> to get started.
      `.trim();
      
      await ctx.reply(message);
      return;
    }
    
    const message = `
🚨 <b>Notification Settings</b>

Configure when you want to receive alerts:

🔔 <b>Loan Alerts</b>
• New loan created
• Loan due in 1 hour
• Loan due in 15 minutes
• Loan liquidated

📈 <b>Price Alerts</b>
• Token price drops significantly
• Approaching liquidation price

⚙️ Use the buttons below to configure your preferences.
    `.trim();
    
    const keyboard = new InlineKeyboard()
      .text('🔔 Enable All', 'alerts_enable_all')
      .text('🔕 Disable All', 'alerts_disable_all')
      .row()
      .text('⚙️ Loan Alerts', 'alerts_config_loans')
      .text('📈 Price Alerts', 'alerts_config_prices')
      .row()
      .text('📊 Current Settings', 'alerts_show_current')
      .text('🔙 Main Menu', 'main_menu');
    
    await ctx.reply(message, {
      reply_markup: keyboard,
    });
    
  } catch (error: any) {
    console.error('Error in alerts command:', error);
    await ctx.reply('❌ Failed to load alert settings. Please try again later.');
  }
}