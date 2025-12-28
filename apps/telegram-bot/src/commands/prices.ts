import { BotContext } from '../bot.js';
import { InlineKeyboard } from 'grammy';
import { apiClient } from '../utils/api.js';
import { formatPrice, formatPercentage } from '../utils/formatters.js';

export async function handlePrices(ctx: BotContext) {
  try {
    await ctx.reply('💰 <i>Fetching current token prices...</i>');
    
    // Get supported tokens with prices
    const tokens = await apiClient.getTokens();
    
    if (!tokens || tokens.length === 0) {
      await ctx.reply('❌ No supported tokens found.');
      return;
    }
    
    let message = '💰 <b>Current Token Prices</b>\n\n';
    
    tokens.forEach((token, index) => {
      const priceChange = token.priceChange24h;
      const changeEmoji = priceChange >= 0 ? '🟢' : '🔴';
      const changeText = priceChange >= 0 ? '+' : '';
      
      message += `${index + 1}. <b>${token.symbol}</b>\n`;
      message += `   💵 $${formatPrice(token.currentPrice)}\n`;
      message += `   ${changeEmoji} ${changeText}${formatPercentage(priceChange)} (24h)\n`;
      message += `   📊 ${token.activeLoans} active loans\n\n`;
    });
    
    message += '<i>Prices update every 10 seconds</i>';
    
    // Create keyboard for token details
    const keyboard = new InlineKeyboard();
    
    // Add popular tokens
    const popularTokens = tokens.slice(0, 6);
    for (let i = 0; i < popularTokens.length; i += 2) {
      const token1 = popularTokens[i];
      const token2 = popularTokens[i + 1];
      
      if (token2) {
        keyboard
          .text(`📈 ${token1.symbol}`, `price:${token1.mint}`)
          .text(`📈 ${token2.symbol}`, `price:${token2.mint}`)
          .row();
      } else {
        keyboard.text(`📈 ${token1.symbol}`, `price:${token1.mint}`).row();
      }
    }
    
    keyboard.text('🔄 Refresh', 'refresh_prices')
      .text('🌐 Web App', 'web_app');
    
    await ctx.editMessageText(message, {
      reply_markup: keyboard,
    });
    
  } catch (error: any) {
    console.error('Error fetching prices:', error);
    
    await ctx.reply('❌ Failed to fetch token prices. Please try again later.');
  }
}