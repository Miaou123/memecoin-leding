import TelegramBot from 'node-telegram-bot-api';
import { securityMonitor } from './security-monitor.service.js';
import type {
  VerificationRequest,
  VerificationRequestStatus,
  ReviewVerificationRequestInput,
} from '@memecoin-lending/types';

export class TelegramVerificationService {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private webAppUrl: string;
  
  constructor() {
    this.chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
    this.webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';
    
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_VERIFICATION_ENABLED === 'true') {
      this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
        polling: false // We'll use webhooks instead
      });
      
      console.log('📱 Telegram verification service initialized');
    }
  }
  
  async sendVerificationRequest(request: VerificationRequest & { tokenInfo?: any }) {
    if (!this.bot || !this.chatId) {
      console.warn('Telegram verification service not configured');
      return null;
    }
    
    try {
      const tokenInfo = request.tokenInfo || {};
      const explorerUrl = `https://solscan.io/token/${request.mint}`;
      const dexScreenerUrl = `https://dexscreener.com/solana/${tokenInfo.poolAddress || request.mint}`;
      
      // Format the message
      const message = `
🔍 <b>New Token Verification Request</b>

<b>Token:</b> ${tokenInfo.symbol || 'Unknown'} ${tokenInfo.name ? `(${tokenInfo.name})` : ''}
<b>Mint:</b> <code>${request.mint}</code>
<b>Requested by:</b> <code>${request.requestedBy}</code>
${request.reason ? `<b>Reason:</b> ${request.reason}` : ''}

<b>Pool Info:</b>
${tokenInfo.poolAddress ? `• Pool: <code>${tokenInfo.poolAddress}</code>` : '• No pool data available'}
${tokenInfo.liquidity ? `• Liquidity: $${tokenInfo.liquidity.toLocaleString()}` : ''}
${tokenInfo.marketCap ? `• Market Cap: $${tokenInfo.marketCap.toLocaleString()}` : ''}

<b>Links:</b>
• <a href="${explorerUrl}">View on Solscan</a>
• <a href="${dexScreenerUrl}">View on DexScreener</a>

Request ID: <code>${request.id}</code>
`;
      
      // Create inline keyboard with approve/reject buttons
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: '✅ Approve (Bronze)',
              callback_data: `verify:approve:${request.id}:bronze`
            },
            {
              text: '🥈 Approve (Silver)',
              callback_data: `verify:approve:${request.id}:silver`
            },
          ],
          [
            {
              text: '🥇 Approve (Gold)',
              callback_data: `verify:approve:${request.id}:gold`
            },
            {
              text: '❌ Reject',
              callback_data: `verify:reject:${request.id}`
            },
          ],
          [
            {
              text: '🔗 Open in Admin Panel',
              url: `${this.webAppUrl}/admin/verification-requests`
            }
          ]
        ]
      };
      
      // Send the message
      const sentMessage = await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });
      
      // Log security event
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'TokenVerification',
        eventType: 'VERIFICATION_REQUEST_SENT',
        message: 'Token verification request sent to Telegram',
        details: {
          requestId: request.id,
          mint: request.mint,
          requestedBy: request.requestedBy,
          telegramMessageId: sentMessage.message_id,
        },
        source: 'telegram-verification',
      });
      
      return sentMessage.message_id.toString();
    } catch (error) {
      console.error('Failed to send verification request to Telegram:', error);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'TokenVerification',
        eventType: 'TELEGRAM_SEND_FAILED',
        message: 'Failed to send verification request to Telegram',
        details: {
          requestId: request.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        source: 'telegram-verification',
      });
      
      return null;
    }
  }
  
  async updateVerificationMessage(
    messageId: string,
    request: VerificationRequest,
    action: 'approve' | 'reject',
    tier?: string
  ) {
    if (!this.bot || !this.chatId) {
      return;
    }
    
    try {
      const statusEmoji = action === 'approve' ? '✅' : '❌';
      const statusText = action === 'approve' 
        ? `APPROVED (${tier?.toUpperCase() || 'BRONZE'})` 
        : 'REJECTED';
      
      const updatedMessage = `
${statusEmoji} <b>Token Verification ${statusText}</b>

<b>Token:</b> <code>${request.mint}</code>
<b>Requested by:</b> <code>${request.requestedBy}</code>
${request.reason ? `<b>Reason:</b> ${request.reason}` : ''}

<b>Decision:</b>
• Status: ${statusText}
• Reviewed by: ${request.reviewedBy || 'Admin'}
• Reviewed at: ${new Date(request.reviewedAt || Date.now()).toLocaleString()}
${request.adminResponse ? `• Response: ${request.adminResponse}` : ''}

Request ID: <code>${request.id}</code>
`;
      
      await this.bot.editMessageText(updatedMessage, {
        chat_id: this.chatId,
        message_id: parseInt(messageId),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] } // Remove buttons
      });
      
    } catch (error) {
      console.error('Failed to update Telegram message:', error);
    }
  }
  
  async handleCallbackQuery(query: any): Promise<ReviewVerificationRequestInput | null> {
    if (!query.data || !query.data.startsWith('verify:')) {
      return null;
    }
    
    const [, action, requestId, tier] = query.data.split(':');
    
    if (action !== 'approve' && action !== 'reject') {
      return null;
    }
    
    // Answer the callback query to remove loading state
    if (this.bot) {
      await this.bot.answerCallbackQuery(query.id, {
        text: `Request ${action}ed${tier ? ` as ${tier}` : ''}!`
      });
    }
    
    return {
      requestId,
      action: action as 'approve' | 'reject',
      reviewedBy: query.from.username || query.from.id.toString(),
      tier: tier as 'bronze' | 'silver' | 'gold' | undefined,
    };
  }
  
  isConfigured(): boolean {
    return this.bot !== null && this.chatId !== '';
  }
}

// Export singleton instance
export const telegramVerificationService = new TelegramVerificationService();