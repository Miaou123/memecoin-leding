import { config } from 'dotenv';
import { bot } from './bot.js';

// Load environment variables
config();

async function main() {
  try {
    console.log('🤖 Starting Memecoin Lending Telegram Bot...');
    
    // Start the bot
    await bot.start();
    
    console.log('✅ Bot started successfully');
    console.log('Bot username:', bot.botInfo.username);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
const shutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  bot.stop();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the bot
main();