import { BotContext } from '../bot.js';
import { mainMenuKeyboard } from '../keyboards/main.js';

export async function handleStart(ctx: BotContext) {
  const user = ctx.from;
  if (!user) return;
  
  const welcomeMessage = `
🎉 <b>Welcome to Memecoin Lending Protocol!</b>

I'm your personal lending assistant bot. Here's what I can help you with:

🔗 <b>Link Wallet</b> - Connect your Solana wallet for notifications
📊 <b>View Loans</b> - Check your active and past loans
💰 <b>Token Prices</b> - Get current prices of supported memecoins
🚨 <b>Alerts</b> - Configure loan and price notifications

<i>To get started, use the buttons below or type /help for more information.</i>
  `.trim();
  
  await ctx.reply(welcomeMessage, {
    reply_markup: mainMenuKeyboard,
  });
}`;
}

export async function handleStart(ctx: BotContext) {
  const user = ctx.from;
  if (!user) return;
  
  const welcomeMessage = `
🎉 <b>Welcome to Memecoin Lending Protocol!</b>

I'm your personal lending assistant bot. Here's what I can help you with:

🔗 <b>Link Wallet</b> - Connect your Solana wallet for notifications
📊 <b>View Loans</b> - Check your active and past loans
💰 <b>Token Prices</b> - Get current prices of supported memecoins
🚨 <b>Alerts</b> - Configure loan and price notifications

<i>To get started, use the buttons below or type /help for more information.</i>
  `.trim();
  
  await ctx.reply(welcomeMessage, {
    reply_markup: mainMenuKeyboard,
  });
}