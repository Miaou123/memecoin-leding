import { InlineKeyboard } from 'grammy';

export const mainMenuKeyboard = new InlineKeyboard()
  .text('🔗 Link Wallet', 'link_wallet')
  .text('📊 My Loans', 'my_loans')
  .row()
  .text('💰 Token Prices', 'token_prices')
  .text('🚨 Alerts', 'alerts_config')
  .row()
  .text('ℹ️ Help', 'help')
  .text('🌐 Web App', 'web_app');

export const walletLinkedKeyboard = new InlineKeyboard()
  .text('📊 My Loans', 'my_loans')
  .text('💰 Prices', 'token_prices')
  .row()
  .text('🚨 Alerts', 'alerts_config')
  .text('🔓 Unlink', 'unlink_wallet');

export const alertsKeyboard = new InlineKeyboard()
  .text('🔔 Enable All', 'alerts_enable_all')
  .text('🔕 Disable All', 'alerts_disable_all')
  .row()
  .text('⚙️ Configure', 'alerts_configure')
  .text('🔙 Back', 'main_menu');