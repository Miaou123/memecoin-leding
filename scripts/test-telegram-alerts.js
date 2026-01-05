#!/usr/bin/env node

/**
 * Quick test script for Telegram bot configuration
 * Usage: node scripts/test-telegram-alerts.js
 */

import 'dotenv/config';

async function testTelegramBot() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId || botToken === 'your_bot_token_here' || chatId === 'your_chat_id_here') {
    console.error('❌ Please configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env file');
    console.log('📖 See docs/TELEGRAM_SETUP.md for instructions');
    process.exit(1);
  }

  console.log('🔍 Testing Telegram bot configuration...');
  console.log(`   Bot Token: ${botToken.substring(0, 10)}...${botToken.substring(botToken.length - 5)}`);
  console.log(`   Chat ID: ${chatId}`);

  try {
    // Test bot info
    const botResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const botData = await botResponse.json();
    
    if (!botData.ok) {
      throw new Error(`Invalid bot token: ${botData.description}`);
    }

    console.log(`✅ Bot verified: @${botData.result.username}`);

    // Test sending a message
    const testMessage = `🔐 **Security Monitor Test**\n\n` +
      `This is a test message from your Memecoin Lending security monitoring system.\n\n` +
      `If you receive this, your Telegram alerts are configured correctly! 🎉\n\n` +
      `_Timestamp: ${new Date().toISOString()}_`;

    const sendResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMessage,
        parse_mode: 'Markdown'
      })
    });

    const sendData = await sendResponse.json();
    
    if (!sendData.ok) {
      throw new Error(`Failed to send message: ${sendData.description}`);
    }

    console.log('🎉 Test message sent successfully!');
    console.log('📱 Check your Telegram to see the test message');
    console.log('');
    console.log('✅ Your Telegram bot is configured correctly');
    console.log('🚀 Start your server to begin receiving security alerts');

  } catch (error) {
    console.error('❌ Telegram test failed:', error.message);
    console.log('');
    console.log('🔧 Common issues:');
    console.log('   • Invalid bot token');
    console.log('   • Bot was blocked or deleted');
    console.log('   • Invalid chat ID');
    console.log('   • Bot not added to group chat');
    console.log('');
    console.log('📖 See docs/TELEGRAM_SETUP.md for setup instructions');
    process.exit(1);
  }
}

testTelegramBot();