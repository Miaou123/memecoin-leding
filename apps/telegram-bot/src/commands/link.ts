import { BotContext } from '../bot.js';
import { apiClient } from '../utils/api.js';

export async function handleLink(ctx: BotContext) {
  const args = ctx.match;
  const telegramId = ctx.from?.id.toString();
  
  if (!telegramId) {
    await ctx.reply('❌ Unable to get your Telegram ID. Please try again.');
    return;
  }
  
  if (!args || typeof args !== 'string') {
    const message = `
🔗 <b>Link Your Wallet</b>

To link your Solana wallet and receive notifications:

1. Go to the <a href="${process.env.WEB_APP_URL || 'https://app.memecoin-lending.com'}">web app</a>
2. Connect your wallet
3. Go to settings and link your Telegram account
4. Use the link code provided there with this command

<b>Usage:</b> <code>/link YOUR_WALLET_ADDRESS</code>

<i>Example:</i> <code>/link 7xKXtg2CW87d...</code>
    `.trim();
    
    await ctx.reply(message);
    return;
  }
  
  const walletAddress = args.trim();
  
  // Validate wallet address format (basic check)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
    await ctx.reply('❌ Invalid wallet address format. Please check and try again.');
    return;
  }
  
  try {
    // Link the wallet to this Telegram account
    await apiClient.linkTelegramAccount(
      walletAddress,
      telegramId,
      ctx.from?.username
    );
    
    // Update session
    ctx.session.walletAddress = walletAddress;
    
    const message = `
✅ <b>Wallet Linked Successfully!</b>

Your wallet <code>${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}</code> has been linked to your Telegram account.

🔔 You will now receive notifications for:
• Loan status updates
• Due date reminders
• Liquidation alerts
• Price alerts (if enabled)

Use /alerts to configure your notification preferences.
    `.trim();
    
    await ctx.reply(message);
    
  } catch (error: any) {
    console.error('Error linking wallet:', error);
    
    if (error.message.includes('already linked')) {
      await ctx.reply('❌ This wallet is already linked to another Telegram account.');
    } else if (error.message.includes('not found')) {
      await ctx.reply('❌ Wallet address not found. Make sure you have used the protocol first.');
    } else {
      await ctx.reply('❌ Failed to link wallet. Please try again later.');
    }
  }
}