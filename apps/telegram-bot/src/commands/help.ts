import { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';

export async function handleHelp(ctx: BotContext) {
  const helpMessage = `
ℹ️ <b>Help - Memecoin Lending Bot</b>

<b>📚 Available Commands:</b>

🔗 <b>/link</b> - Link your Solana wallet
   <i>Usage: /link YOUR_WALLET_ADDRESS</i>
   <i>This enables notifications for your loans</i>

📊 <b>/loans</b> - View your current loans
   <i>Shows active loans and loan history</i>

💰 <b>/prices</b> - Current token prices
   <i>Real-time prices of supported memecoins</i>

🚨 <b>/alerts</b> - Configure notifications
   <i>Set up loan and price alerts</i>

❓ <b>/help</b> - Show this help message

<b>🌐 Web Interface:</b>
Visit our <a href="${process.env.WEB_APP_URL || 'https://app.memecoin-lending.com'}">web application</a> to:
• Create new loans
• Manage existing loans
• View detailed analytics
• Access advanced features

<b>🔔 Notifications:</b>
Once your wallet is linked, you'll receive:
• Loan creation confirmations
• Due date reminders (1h and 15m before)
• Liquidation alerts
• Price drop warnings

<b>🆘 Support:</b>
For support or questions:
• Check our documentation
• Join our community chat
• Contact support team

<i>💡 Tip: All your loan data is fetched directly from the Solana blockchain</i>
  `.trim();
  
  const keyboard = new InlineKeyboard()
    .text('🌐 Web App', 'web_app')
    .text('💬 Support', 'support')
    .row()
    .text('🔙 Main Menu', 'main_menu');
  
  await ctx.reply(helpMessage, {
    reply_markup: keyboard,
  });
}