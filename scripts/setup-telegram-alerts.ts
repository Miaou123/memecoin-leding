#!/usr/bin/env tsx

import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Config {
  botToken?: string;
  chatId?: string;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function displayBanner() {
  console.clear();
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.cyan.bold('     TELEGRAM SECURITY ALERTS SETUP'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log();
}

async function createBotInstructions() {
  console.log(chalk.yellow.bold('📱 Step 1: Create a Telegram Bot\n'));
  
  console.log(chalk.white('1. Open Telegram and search for') + chalk.cyan(' @BotFather'));
  console.log(chalk.white('2. Start a conversation and send') + chalk.green(' /newbot'));
  console.log(chalk.white('3. Choose a name for your bot (e.g., "Memecoin Lending Alerts")'));
  console.log(chalk.white('4. Choose a username ending in "bot" (e.g., "memecoin_lending_alerts_bot")'));
  console.log(chalk.white('5. BotFather will give you a token like:'));
  console.log(chalk.gray('   123456789:ABCdefGHIjklMNOpqrsTUVwxyz'));
  console.log();
  
  await question(chalk.magenta('Press Enter when you have created your bot...'));
}

async function getBotToken(): Promise<string> {
  console.log();
  console.log(chalk.yellow.bold('📝 Step 2: Enter Bot Token\n'));
  
  let token = '';
  while (!token || !token.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    token = await question(chalk.cyan('Enter your bot token: '));
    if (!token.match(/^\d+:[A-Za-z0-9_-]+$/)) {
      console.log(chalk.red('❌ Invalid token format. Please try again.'));
    }
  }
  
  console.log(chalk.green('✅ Token format looks valid!'));
  return token;
}

async function getChatIdInstructions(botToken: string) {
  console.log();
  console.log(chalk.yellow.bold('💬 Step 3: Get Your Chat ID\n'));
  
  const botUsername = await question(chalk.cyan('What username did you give your bot? (e.g., memecoin_alerts_bot): '));
  
  console.log();
  console.log(chalk.white('1. Open Telegram and search for') + chalk.cyan(` @${botUsername}`));
  console.log(chalk.white('2. Start a conversation with your bot'));
  console.log(chalk.white('3. Send any message to the bot (e.g., "Hello")'));
  console.log();
  
  await question(chalk.magenta('Press Enter after sending a message to your bot...'));
  
  console.log();
  console.log(chalk.yellow('🔍 Fetching chat ID...'));
  await wait(1000);
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.description || 'Failed to fetch updates');
    }
    
    if (data.result && data.result.length > 0) {
      const chatIds = new Set<string>();
      
      data.result.forEach((update: any) => {
        if (update.message?.chat?.id) {
          chatIds.add(update.message.chat.id.toString());
        }
      });
      
      if (chatIds.size === 0) {
        throw new Error('No messages found');
      }
      
      console.log(chalk.green('\n✅ Found chat ID(s):'));
      const chatIdArray = Array.from(chatIds);
      chatIdArray.forEach((id, index) => {
        console.log(chalk.cyan(`   ${index + 1}. ${id}`));
      });
      
      if (chatIdArray.length === 1) {
        return chatIdArray[0];
      }
      
      const choice = await question(chalk.cyan('\nSelect chat ID (enter number): '));
      const index = parseInt(choice) - 1;
      
      if (index >= 0 && index < chatIdArray.length) {
        return chatIdArray[index];
      }
      
      return chatIdArray[0];
    } else {
      throw new Error('No messages found. Make sure you sent a message to your bot.');
    }
  } catch (error: any) {
    console.log(chalk.red('❌ Could not automatically fetch chat ID:', error.message));
    console.log();
    console.log(chalk.yellow('📋 Manual method:'));
    console.log(chalk.white('1. Open this URL in your browser:'));
    console.log(chalk.cyan(`   https://api.telegram.org/bot${botToken}/getUpdates`));
    console.log(chalk.white('2. Look for "chat":{"id": NUMBER'));
    console.log(chalk.white('3. That NUMBER is your chat ID'));
    console.log();
    
    const chatId = await question(chalk.cyan('Enter your chat ID: '));
    return chatId;
  }
}

async function testAlert(botToken: string, chatId: string): Promise<boolean> {
  console.log();
  console.log(chalk.yellow.bold('🧪 Step 4: Test Alert\n'));
  console.log(chalk.gray('Sending test message...'));
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🎉 <b>Success!</b>\n\nTelegram alerts are now configured for Memecoin Lending Security Monitor.\n\nYou will receive alerts when security events occur.\n\n<i>Time: ${new Date().toISOString()}</i>`,
        parse_mode: 'HTML',
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(chalk.green('✅ Test message sent successfully!'));
      console.log(chalk.gray('Check your Telegram for the message.'));
      return true;
    } else {
      throw new Error(result.description || 'Failed to send message');
    }
  } catch (error: any) {
    console.log(chalk.red('❌ Failed to send test message:', error.message));
    return false;
  }
}

async function updateEnvFile(config: Config) {
  console.log();
  console.log(chalk.yellow.bold('💾 Step 5: Update Configuration\n'));
  
  const envPath = path.join(__dirname, '..', '.env');
  const envExamplePath = path.join(__dirname, '..', '.env.example');
  
  // Check if .env exists
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log(chalk.gray('Found existing .env file'));
  } else if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf8');
    console.log(chalk.gray('Creating .env from .env.example'));
  }
  
  // Update or add Telegram configuration
  const lines = envContent.split('\n');
  const updatedLines: string[] = [];
  let foundToken = false;
  let foundChatId = false;
  let foundEnabled = false;
  
  for (const line of lines) {
    if (line.startsWith('TELEGRAM_BOT_TOKEN=')) {
      updatedLines.push(`TELEGRAM_BOT_TOKEN=${config.botToken}`);
      foundToken = true;
    } else if (line.startsWith('TELEGRAM_CHAT_ID=')) {
      updatedLines.push(`TELEGRAM_CHAT_ID=${config.chatId}`);
      foundChatId = true;
    } else if (line.startsWith('TELEGRAM_ALERTS_ENABLED=')) {
      updatedLines.push('TELEGRAM_ALERTS_ENABLED=true');
      foundEnabled = true;
    } else {
      updatedLines.push(line);
    }
  }
  
  // Add missing configurations
  if (!foundToken || !foundChatId || !foundEnabled) {
    // Find the security section or add at the end
    const securityIndex = updatedLines.findIndex(line => line.includes('# Security Alerting'));
    
    const newLines: string[] = [];
    if (!foundToken) newLines.push(`TELEGRAM_BOT_TOKEN=${config.botToken}`);
    if (!foundChatId) newLines.push(`TELEGRAM_CHAT_ID=${config.chatId}`);
    if (!foundEnabled) newLines.push('TELEGRAM_ALERTS_ENABLED=true');
    
    if (securityIndex >= 0) {
      // Insert after security section header
      updatedLines.splice(securityIndex + 1, 0, ...newLines);
    } else {
      // Add new section
      updatedLines.push('');
      updatedLines.push('# Security Alerting');
      updatedLines.push('SECURITY_ALERTS_ENABLED=true');
      updatedLines.push(...newLines);
    }
  }
  
  const answer = await question(chalk.cyan('Update .env file? (y/n): '));
  
  if (answer.toLowerCase() === 'y') {
    fs.writeFileSync(envPath, updatedLines.join('\n'));
    console.log(chalk.green('✅ .env file updated successfully!'));
  } else {
    console.log();
    console.log(chalk.yellow('📋 Manual configuration:'));
    console.log(chalk.gray('Add these lines to your .env file:'));
    console.log();
    console.log(chalk.white(`TELEGRAM_BOT_TOKEN=${config.botToken}`));
    console.log(chalk.white(`TELEGRAM_CHAT_ID=${config.chatId}`));
    console.log(chalk.white('TELEGRAM_ALERTS_ENABLED=true'));
  }
}

async function main() {
  await displayBanner();
  
  console.log(chalk.white('This wizard will help you set up Telegram security alerts.\n'));
  
  try {
    // Step 1: Create bot
    await createBotInstructions();
    
    // Step 2: Get token
    const botToken = await getBotToken();
    
    // Step 3: Get chat ID
    const chatId = await getChatIdInstructions(botToken);
    
    // Step 4: Test
    const testSuccess = await testAlert(botToken, chatId);
    
    if (testSuccess) {
      // Step 5: Update config
      await updateEnvFile({ botToken, chatId });
      
      console.log();
      console.log(chalk.green('═'.repeat(60)));
      console.log(chalk.green.bold('     ✅ SETUP COMPLETE!'));
      console.log(chalk.green('═'.repeat(60)));
      console.log();
      console.log(chalk.white('Telegram alerts are now configured.'));
      console.log(chalk.white('Security events will be sent to your Telegram chat.'));
      console.log();
      console.log(chalk.gray('To test from the server:'));
      console.log(chalk.cyan('  curl -X POST http://localhost:3002/api/admin/security/test-alert \\'));
      console.log(chalk.cyan('    -H "X-Admin-Key: YOUR_ADMIN_KEY"'));
    } else {
      console.log();
      console.log(chalk.red('Setup incomplete. Please check your configuration and try again.'));
    }
  } catch (error: any) {
    console.error(chalk.red('\n❌ Setup failed:'), error.message);
  }
  
  rl.close();
}

main().catch(console.error);