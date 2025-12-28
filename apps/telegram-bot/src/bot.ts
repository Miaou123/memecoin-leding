import { Bot, Context, session, SessionFlavor } from 'grammy';
import { hydrate, HydrateFlavor } from '@grammyjs/hydrate';
import { parseMode, ParseModeFlavor } from '@grammyjs/parse-mode';

// Import command handlers
import { handleStart } from './commands/start.js';
import { handleLink } from './commands/link.js';
import { handleLoans } from './commands/loans.js';
import { handlePrices } from './commands/prices.js';
import { handleAlerts } from './commands/alerts.js';
import { handleHelp } from './commands/help.js';

// Import callback handlers
import { handleLoanDetails } from './handlers/loanDetails.js';
import { handleAlertConfig } from './handlers/alertConfig.js';

// Session data interface
interface SessionData {
  walletAddress?: string;
  isLinking?: boolean;
  pendingLinkCode?: string;
  alertsEnabled?: boolean;
  priceThreshold?: number;
}

// Bot context type with flavors
type BotContext = Context & 
  SessionFlavor<SessionData> & 
  HydrateFlavor<Context> & 
  ParseModeFlavor<Context>;

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

// Create bot instance
export const bot = new Bot<BotContext>(token);

// Install plugins
bot.use(hydrate());
bot.api.config.use(parseMode('HTML'));

// Install session middleware
bot.use(session({
  initial: (): SessionData => ({}),
}));

// Command handlers
bot.command('start', handleStart);
bot.command('link', handleLink);
bot.command('loans', handleLoans);
bot.command('prices', handlePrices);
bot.command('alerts', handleAlerts);
bot.command('help', handleHelp);

// Callback query handlers
bot.callbackQuery(/^loan:/, handleLoanDetails);
bot.callbackQuery(/^alert:/, handleAlertConfig);

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  
  if (e instanceof Error) {
    console.error('Error name:', e.name);
    console.error('Error message:', e.message);
    console.error('Error stack:', e.stack);
  }
  
  // Try to notify user about the error
  try {
    ctx.reply('❌ Sorry, something went wrong. Please try again later.');
  } catch {
    // Ignore if we can't send the error message
  }
});

export type { BotContext, SessionData };