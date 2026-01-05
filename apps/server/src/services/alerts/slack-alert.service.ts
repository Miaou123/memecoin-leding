import type { SecurityEvent } from '@memecoin-lending/types';

export class SlackAlertService {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    if (!webhookUrl) {
      throw new Error('Slack webhook URL is required');
    }
    this.webhookUrl = webhookUrl;
  }

  async sendAlert(event: SecurityEvent): Promise<boolean> {
    try {
      const blocks = this.createBlocks(event);
      
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          blocks,
          username: 'Security Monitor',
          icon_emoji: ':warning:',
        }),
      });

      return response.ok;
    } catch (error: any) {
      console.error('Failed to send Slack alert:', error.message);
      return false;
    }
  }

  private createBlocks(event: SecurityEvent): any[] {
    const severityEmoji = {
      'CRITICAL': ':red_circle:',
      'HIGH': ':rotating_light:',
      'MEDIUM': ':warning:',
      'LOW': ':information_source:',
    }[event.severity];

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityEmoji} Security Alert [${event.severity}]`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Message:*\n${event.message}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Category:*\n${event.category}`,
          },
          {
            type: 'mrkdwn',
            text: `*Event Type:*\n${event.eventType}`,
          },
          {
            type: 'mrkdwn',
            text: `*Source:*\n${event.source}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${event.timestamp.toISOString()}`,
          },
        ],
      },
    ];

    // Add details section if present
    if (event.details && Object.keys(event.details).length > 0) {
      const detailsText = Object.entries(event.details)
        .map(([key, value]) => {
          const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
          const truncatedValue = this.truncateValue(valueStr);
          return `*${key}:* \`${truncatedValue}\``;
        })
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:*\n${detailsText}`,
        },
      });
    }

    // Add additional fields if present
    const additionalFields = [];
    
    if (event.userId) {
      additionalFields.push({
        type: 'mrkdwn',
        text: `*User:*\n\`${event.userId}\``,
      });
    }

    if (event.ip) {
      additionalFields.push({
        type: 'mrkdwn',
        text: `*IP Address:*\n\`${event.ip}\``,
      });
    }

    if (additionalFields.length > 0) {
      blocks.push({
        type: 'section',
        fields: additionalFields,
      });
    }

    if (event.txSignature) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Transaction:*\n\`${event.txSignature}\``,
        },
      });
    }

    // Add context footer
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_Memecoin Lending Security Monitor_',
        },
      ],
    } as any);

    return blocks;
  }

  private truncateValue(value: string): string {
    if (value.length <= 100) {
      return value;
    }
    
    // Show first 40 and last 40 characters
    return `${value.substring(0, 40)}...${value.substring(value.length - 40)}`;
  }
}