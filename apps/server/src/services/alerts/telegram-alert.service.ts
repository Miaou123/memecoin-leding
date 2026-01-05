import type { SecurityEvent, SecuritySeverity } from '@memecoin-lending/types';

const SEVERITY_EMOJI: Record<SecuritySeverity, string> = {
  CRITICAL: '🔴',
  HIGH: '🚨',
  MEDIUM: '⚠️',
  LOW: 'ℹ️',
};

export class TelegramAlertService {
  private botToken: string;
  private chatId: string;
  private apiUrl: string;

  constructor(botToken: string, chatId: string) {
    if (!botToken || !chatId) {
      throw new Error('Telegram bot token and chat ID are required');
    }
    
    this.botToken = botToken;
    this.chatId = chatId;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendAlert(event: SecurityEvent): Promise<boolean> {
    try {
      const message = this.formatMessage(event);
      
      console.log('🔍 Debug: Sending Telegram alert:', {
        apiUrl: this.apiUrl,
        chatId: this.chatId,
        messageLength: message.length
      });
      
      const payload = {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      
      console.log('📤 Telegram API payload:', payload);
      
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json() as any;
      
      console.log('📥 Telegram API response:', {
        status: response.status,
        ok: response.ok,
        result: result
      });
      
      if (!response.ok || !result.ok) {
        console.error('Telegram API error:', result);
        return false;
      }

      console.log('✅ Telegram alert sent successfully');
      return true;
    } catch (error: any) {
      console.error('Failed to send Telegram alert:', error.message);
      return false;
    }
  }

  async sendTestMessage(): Promise<boolean> {
    try {
      const message = `🧪 <b>TEST ALERT</b>\n\n` +
        `This is a test message from Memecoin Lending Security Monitor.\n\n` +
        `If you see this message, Telegram alerts are working correctly! ✅\n\n` +
        `<i>Time: ${new Date().toISOString()}</i>`;
      
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      const result = await response.json() as any;
      return response.ok && result.ok;
    } catch (error: any) {
      console.error('Failed to send Telegram test message:', error.message);
      return false;
    }
  }

  private formatMessage(event: SecurityEvent): string {
    const emoji = SEVERITY_EMOJI[event.severity];
    
    let message = `${emoji} <b>SECURITY ALERT [${event.severity}]</b>\n`;
    message += `<b>Category:</b> ${this.escapeHtml(event.category)}\n`;
    message += `<b>Time:</b> ${event.timestamp.toISOString()}\n`;
    message += `<b>Source:</b> ${this.escapeHtml(event.source)}\n\n`;
    message += `<b>Message:</b>\n${this.escapeHtml(event.message)}\n`;

    if (event.details && Object.keys(event.details).length > 0) {
      message += `\n<b>Details:</b>\n`;
      for (const [key, value] of Object.entries(event.details)) {
        const formattedValue = this.formatValue(value);
        message += `<code>${this.escapeHtml(key)}:</code> ${formattedValue}\n`;
      }
    }

    message += `\n─────────────────\n`;
    message += `<i>Memecoin Lending Security Monitor</i>`;

    // Telegram message limit is 4096 characters
    if (message.length > 4000) {
      message = message.substring(0, 3900) + '\n\n... (truncated)\n\n─────────────────\n<i>Memecoin Lending Security Monitor</i>';
    }

    return message;
  }

  private formatValue(value: any): string {
    if (typeof value === 'string' && value.length > 44) {
      // Likely a public key or hash - truncate
      return `<code>${this.escapeHtml(value.substring(0, 20))}...${value.substring(value.length - 20)}</code>`;
    }
    
    if (typeof value === 'object') {
      return `<code>${this.escapeHtml(JSON.stringify(value, null, 2))}</code>`;
    }
    
    return `<code>${this.escapeHtml(String(value))}</code>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}