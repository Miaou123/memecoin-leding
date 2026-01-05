#!/usr/bin/env node

/**
 * Debug Telegram bot configuration to find the exact issue
 */

import 'dotenv/config';

async function debugTelegramBot() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log('🔍 Debugging Telegram bot configuration...');
  console.log(`   Bot Token: ${botToken}`);
  console.log(`   Chat ID: ${chatId}`);
  console.log('');

  if (!botToken || !chatId) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    process.exit(1);
  }

  try {
    // Step 1: Check bot info
    console.log('1️⃣ Testing bot token...');
    const botResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const botData = await botResponse.json();
    
    if (!botData.ok) {
      console.error('❌ Invalid bot token:', botData.description);
      process.exit(1);
    }

    console.log(`✅ Bot verified: @${botData.result.username}`);
    console.log('');

    // Step 2: Get recent updates to see if chat exists
    console.log('2️⃣ Checking recent updates...');
    const updatesResponse = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
    const updatesData = await updatesResponse.json();
    
    if (updatesData.ok && updatesData.result.length > 0) {
      console.log(`📬 Found ${updatesData.result.length} recent update(s)`);
      
      // Show available chat IDs
      const chatIds = new Set();
      updatesData.result.forEach(update => {
        if (update.message?.chat?.id) {
          chatIds.add(update.message.chat.id.toString());
        }
      });
      
      if (chatIds.size > 0) {
        console.log(`📋 Available chat IDs: ${Array.from(chatIds).join(', ')}`);
        
        if (!chatIds.has(chatId)) {
          console.log(`⚠️  Your configured chat ID (${chatId}) was not found in recent updates`);
          console.log(`💡 Try using one of the available chat IDs above`);
        }
      }
    } else {
      console.log('📭 No recent updates found');
    }
    console.log('');

    // Step 3: Try to get chat info
    console.log('3️⃣ Testing chat access...');
    const chatResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId })
    });

    const chatData = await chatResponse.json();
    
    if (!chatData.ok) {
      console.error('❌ Cannot access chat:', chatData.description);
      
      if (chatData.error_code === 404) {
        console.log('');
        console.log('🔧 Common fixes for 404 error:');
        console.log('   • Send /start to your bot');
        console.log('   • Check if chat ID is correct');
        console.log('   • Make sure bot is not blocked');
        console.log('   • For groups: ensure bot is added to group');
      }
      
      process.exit(1);
    }

    console.log(`✅ Chat accessible: ${chatData.result.type}`);
    if (chatData.result.title) {
      console.log(`   Title: ${chatData.result.title}`);
    }
    console.log('');

    // Step 4: Test sending a message
    console.log('4️⃣ Testing message sending...');
    const testMessage = `🔧 Debug Test\n\nThis message confirms your Telegram bot can send alerts.\n\nTime: ${new Date().toISOString()}`;
    
    const sendResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMessage,
        parse_mode: 'HTML'
      })
    });

    const sendData = await sendResponse.json();
    
    if (!sendData.ok) {
      console.error('❌ Failed to send message:', sendData.description);
      console.error('   Response:', sendData);
      process.exit(1);
    }

    console.log('🎉 Message sent successfully!');
    console.log('📱 Check your Telegram for the debug test message');
    console.log('');
    console.log('✅ Telegram configuration is working correctly');
    console.log('🚀 Your security alerts should now work properly');

  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    process.exit(1);
  }
}

debugTelegramBot();