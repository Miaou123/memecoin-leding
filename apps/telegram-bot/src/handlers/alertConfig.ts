import { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';
import { apiClient } from '../utils/api.js';

export async function handleAlertConfig(ctx: BotContext) {
  const callbackData = ctx.callbackQuery?.data;
  
  if (!callbackData) return;
  
  const telegramId = ctx.from?.id.toString();
  
  if (!telegramId) {
    await ctx.answerCallbackQuery('❌ Unable to get your Telegram ID');
    return;
  }
  
  try {
    // Get user by Telegram ID
    const user = await apiClient.getUserByTelegramId(telegramId);
    
    if (!user?.walletAddress) {
      await ctx.answerCallbackQuery('❌ Wallet not linked');
      return;
    }
    
    const action = callbackData.replace('alert:', '');
    
    switch (action) {
      case 'enable_all':
        await apiClient.updateNotificationPreferences(user.walletAddress, {
          loanCreated: true,
          loanDueSoon: true,
          loanLiquidated: true,
          priceAlerts: true,
        });
        
        await ctx.answerCallbackQuery('✅ All alerts enabled');
        await ctx.editMessageText('🔔 <b>All Alerts Enabled</b>\n\nYou will now receive all available notifications.');
        break;
        
      case 'disable_all':
        await apiClient.updateNotificationPreferences(user.walletAddress, {
          loanCreated: false,
          loanDueSoon: false,
          loanLiquidated: false,
          priceAlerts: false,
        });
        
        await ctx.answerCallbackQuery('🔕 All alerts disabled');
        await ctx.editMessageText('🔕 <b>All Alerts Disabled</b>\n\nYou will not receive any notifications.');
        break;
        
      case 'config_loans':
        const loanConfigMessage = `
🔔 <b>Loan Alert Configuration</b>

Configure which loan events trigger notifications:

• <b>Loan Created</b> - Confirmation when you create a new loan
• <b>Due Soon</b> - Warnings at 1h and 15m before due time
• <b>Liquidated</b> - Alert when your loan is liquidated

Use the buttons below to toggle each alert type.
        `.trim();
        
        const loanKeyboard = new InlineKeyboard()
          .text('✅ Loan Created', 'alert_toggle:loan_created')
          .text('⏰ Due Soon', 'alert_toggle:due_soon')
          .row()
          .text('⚠️ Liquidated', 'alert_toggle:liquidated')
          .row()
          .text('🔙 Back', 'alerts_config');
        
        await ctx.editMessageText(loanConfigMessage, {
          reply_markup: loanKeyboard,
        });
        break;
        
      case 'config_prices':
        const priceConfigMessage = `
📈 <b>Price Alert Configuration</b>

Configure price-based notifications:

• <b>Price Drops</b> - Alert when token price drops significantly
• <b>Liquidation Risk</b> - Warning when approaching liquidation price

Current threshold: <b>10%</b> price drop
        `.trim();
        
        const priceKeyboard = new InlineKeyboard()
          .text('📉 5% Threshold', 'alert_threshold:5')
          .text('📉 10% Threshold', 'alert_threshold:10')
          .row()
          .text('📉 15% Threshold', 'alert_threshold:15')
          .text('📉 20% Threshold', 'alert_threshold:20')
          .row()
          .text('🔔 Enable Price Alerts', 'alert_toggle:price_alerts')
          .row()
          .text('🔙 Back', 'alerts_config');
        
        await ctx.editMessageText(priceConfigMessage, {
          reply_markup: priceKeyboard,
        });
        break;
        
      case 'show_current':
        // This would fetch current settings and display them
        const settingsMessage = `
📊 <b>Current Alert Settings</b>

🔔 <b>Loan Alerts:</b>
• Loan Created: ✅ Enabled
• Due Soon: ✅ Enabled
• Liquidated: ✅ Enabled

📈 <b>Price Alerts:</b>
• Price Drops: ✅ Enabled (10% threshold)
• Liquidation Risk: ✅ Enabled

<i>Last updated: Just now</i>
        `.trim();
        
        const settingsKeyboard = new InlineKeyboard()
          .text('⚙️ Modify', 'alerts_config')
          .text('🔙 Main Menu', 'main_menu');
        
        await ctx.editMessageText(settingsMessage, {
          reply_markup: settingsKeyboard,
        });
        break;
        
      default:
        await ctx.answerCallbackQuery('❌ Unknown action');
    }
    
  } catch (error: any) {
    console.error('Error in alert config:', error);
    await ctx.answerCallbackQuery('❌ Failed to update settings');
  }
}