#!/usr/bin/env tsx

import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

interface TestResult {
  channel: string;
  success: boolean;
  message?: string;
  error?: string;
}

async function testTelegram(): Promise<TestResult> {
  console.log(chalk.cyan('📱 Testing Telegram...'));
  
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const enabled = process.env.TELEGRAM_ALERTS_ENABLED !== 'false';
  
  if (!enabled) {
    return { channel: 'Telegram', success: false, error: 'Alerts disabled in configuration' };
  }
  
  if (!token || !chatId) {
    return { channel: 'Telegram', success: false, error: 'Missing bot token or chat ID' };
  }
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🧪 <b>SECURITY ALERT TEST</b>\n\n` +
              `Testing security alerts from Memecoin Lending\n\n` +
              `<b>Severity:</b> HIGH\n` +
              `<b>Category:</b> Test\n` +
              `<b>Time:</b> ${new Date().toISOString()}\n\n` +
              `If you see this message, Telegram alerts are working! ✅`,
        parse_mode: 'HTML',
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      return { channel: 'Telegram', success: true, message: 'Test alert sent successfully' };
    } else {
      return { channel: 'Telegram', success: false, error: result.description || 'Failed to send' };
    }
  } catch (error: any) {
    return { channel: 'Telegram', success: false, error: error.message };
  }
}

async function showConfiguration() {
  console.log(chalk.bold('\n📋 Current Configuration:\n'));
  
  const config = {
    'Security Alerts': process.env.SECURITY_ALERTS_ENABLED !== 'false' ? '✅ Enabled' : '❌ Disabled',
    'Min Severity': process.env.ALERT_MIN_SEVERITY || 'MEDIUM',
    'Rate Limit': `${process.env.ALERT_RATE_LIMIT_MINUTES || '5'} minutes`,
    'Telegram': {
      'Enabled': process.env.TELEGRAM_ALERTS_ENABLED !== 'false' ? '✅' : '❌',
      'Bot Token': process.env.TELEGRAM_BOT_TOKEN ? '✅ Set' : '❌ Missing',
      'Chat ID': process.env.TELEGRAM_CHAT_ID ? '✅ Set' : '❌ Missing',
    },
  };
  
  console.log(chalk.white('General Settings:'));
  console.log(chalk.gray(`  Security Alerts: ${config['Security Alerts']}`));
  console.log(chalk.gray(`  Min Severity: ${config['Min Severity']}`));
  console.log(chalk.gray(`  Rate Limit: ${config['Rate Limit']}`));
  
  console.log(chalk.white('\nTelegram Configuration:'));
  console.log(chalk.gray(`  Enabled: ${config.Telegram.Enabled}`));
  console.log(chalk.gray(`  Bot Token: ${config.Telegram['Bot Token']}`));
  console.log(chalk.gray(`  Chat ID: ${config.Telegram['Chat ID']}`));
}

async function main() {
  const program = new Command();
  
  program
    .name('test-security-alerts')
    .description('Test security alert system for Memecoin Lending')
    .option('--severity <severity>', 'Severity level for test (LOW, MEDIUM, HIGH, CRITICAL)', 'HIGH')
    .option('--show-config', 'Show current configuration only')
    .parse();
  
  const options = program.opts();
  
  console.log(chalk.cyan.bold('\n🔒 Security Alert Test\n'));
  
  if (options.showConfig) {
    await showConfiguration();
    return;
  }
  
  // Show configuration first
  await showConfiguration();
  
  console.log(chalk.bold('\n🧪 Testing Telegram Alerts:\n'));
  
  const result = await testTelegram();
  
  // Display results
  console.log(chalk.bold('\n📊 Test Results:\n'));
  
  if (result.success) {
    console.log(chalk.green(`  ✅ ${result.channel}: ${result.message || 'Success'}`));
    console.log();
    console.log(chalk.green('✅ Alert system is working!'));
    console.log(chalk.gray('\nCheck your Telegram for the test message.'));
  } else {
    console.log(chalk.red(`  ❌ ${result.channel}: ${result.error || 'Failed'}`));
    console.log();
    console.log(chalk.yellow('⚠️  Telegram alerts are not working!'));
    console.log(chalk.gray('\nRun setup script to configure:'));
    console.log(chalk.cyan('  npx tsx scripts/setup-telegram-alerts.ts'));
  }
  
  console.log();
}

main().catch(console.error);