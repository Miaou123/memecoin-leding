import type { SecurityEvent } from '@memecoin-lending/types';

export class DiscordAlertService {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    if (!webhookUrl) {
      throw new Error('Discord webhook URL is required');
    }
    this.webhookUrl = webhookUrl;
  }

  async sendAlert(event: SecurityEvent): Promise<boolean> {
    try {
      const embed = this.createEmbed(event);
      
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          embeds: [embed],
          username: 'Security Monitor',
          avatar_url: 'https://cdn-icons-png.flaticon.com/512/2913/2913465.png'
        }),
      });

      return response.ok;
    } catch (error: any) {
      console.error('Failed to send Discord alert:', error.message);
      return false;
    }
  }

  private createEmbed(event: SecurityEvent): any {
    const colors = {
      'CRITICAL': 0xFF0000, // Red
      'HIGH': 0xFF6600,     // Orange
      'MEDIUM': 0xFFCC00,   // Yellow
      'LOW': 0x00CCFF,      // Blue
    };

    const severityEmoji = {
      'CRITICAL': '🔴',
      'HIGH': '🚨',
      'MEDIUM': '⚠️',
      'LOW': 'ℹ️',
    }[event.severity];

    const embed: any = {
      title: `${severityEmoji} Security Alert [${event.severity}]`,
      description: event.message,
      color: colors[event.severity],
      timestamp: event.timestamp.toISOString(),
      fields: [
        {
          name: 'Category',
          value: event.category,
          inline: true,
        },
        {
          name: 'Event Type',
          value: event.eventType,
          inline: true,
        },
        {
          name: 'Source',
          value: event.source,
          inline: true,
        },
      ],
      footer: {
        text: 'Memecoin Lending Security Monitor',
      },
    };

    // Add details as fields
    if (event.details && Object.keys(event.details).length > 0) {
      const detailsText = Object.entries(event.details)
        .map(([key, value]) => {
          const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
          const truncatedValue = this.truncateValue(valueStr);
          return `**${key}:** \`${truncatedValue}\``;
        })
        .join('\n');

      embed.fields.push({
        name: 'Details',
        value: detailsText.length > 1024 ? detailsText.substring(0, 1020) + '...' : detailsText,
        inline: false,
      });
    }

    if (event.userId) {
      embed.fields.push({
        name: 'User',
        value: `\`${event.userId}\``,
        inline: true,
      });
    }

    if (event.ip) {
      embed.fields.push({
        name: 'IP Address',
        value: `\`${event.ip}\``,
        inline: true,
      });
    }

    if (event.txSignature) {
      embed.fields.push({
        name: 'Transaction',
        value: `\`${event.txSignature}\``,
        inline: false,
      });
    }

    return embed;
  }

  private truncateValue(value: string): string {
    if (value.length <= 100) {
      return value;
    }
    
    // Show first 40 and last 40 characters
    return `${value.substring(0, 40)}...${value.substring(value.length - 40)}`;
  }
}