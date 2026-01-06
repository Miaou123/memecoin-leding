import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import type { 
  SecurityEvent, 
  SecurityEventInput, 
  SecurityStats, 
  AlertConfig, 
  SecuritySeverity,
  SecurityCategory 
} from '@memecoin-lending/types';
import { TelegramAlertService } from './alerts/telegram-alert.service.js';
import { prisma } from '../db/client.js';

// Severity comparison helper
const SEVERITY_ORDER: Record<SecuritySeverity, number> = {
  'LOW': 1, 
  'MEDIUM': 2, 
  'HIGH': 3, 
  'CRITICAL': 4
};

interface EventFilters {
  severity?: SecuritySeverity;
  category?: string;
  eventType?: string;
  since?: string;
}

interface AlertTestResult {
  telegram?: { success: boolean; error?: string };
}

export class SecurityMonitorService {
  private events: SecurityEvent[] = [];
  private maxEvents = 2000;
  private lastAlertTime = new Map<string, number>(); // eventType -> timestamp
  private eventCounters = new Map<string, { count: number; firstSeen: number }>();
  
  private telegramService?: TelegramAlertService;
  
  private config: AlertConfig;
  
  constructor() {
    this.config = {
      minSeverity: (process.env.ALERT_MIN_SEVERITY as SecuritySeverity) || 'MEDIUM',
      rateLimitMinutes: parseInt(process.env.ALERT_RATE_LIMIT_MINUTES || '5'),
    };
    
    // Initialize alert services based on configuration
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_ALERTS_ENABLED !== 'false') {
      this.telegramService = new TelegramAlertService(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID
      );
      this.config.telegram = {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        enabled: true,
      };
    }
    
    console.log(chalk.cyan('🔒 Security Monitor initialized'));
    console.log(chalk.gray(`   Min Severity: ${this.config.minSeverity}`));
    console.log(chalk.gray(`   Rate Limit: ${this.config.rateLimitMinutes} minutes`));
    console.log(chalk.gray(`   Telegram: ${this.telegramService ? '✅' : '❌'}`));
  }
  
  async log(input: SecurityEventInput): Promise<void> {
    const event: SecurityEvent = {
      id: uuidv4(),
      timestamp: new Date(),
      alerted: false,
      ...input,
      details: {
        ...input.details,
        requestId: input.requestId,
      },
    };
    
    // Console log with appropriate formatting
    this.consoleLog(event);
    
    // Store in memory
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(0, this.maxEvents);
    }
    
    // Update counters for pattern detection
    this.updateCounters(event);
    
    // Check if we should alert
    if (this.shouldAlert(event)) {
      event.alerted = true;
      await this.sendAlerts(event);
      this.lastAlertTime.set(event.eventType, Date.now());
    }
    
    // Persist to database if enabled
    if (process.env.SECURITY_PERSIST_TO_DB === 'true' && SEVERITY_ORDER[event.severity] >= SEVERITY_ORDER['MEDIUM']) {
      try {
        await prisma.securityEvent.create({
          data: {
            id: event.id,
            timestamp: event.timestamp,
            severity: event.severity,
            category: event.category,
            eventType: event.eventType,
            message: event.message,
            details: event.details,
            source: event.source,
            userId: event.userId,
            ip: event.ip,
            txSignature: event.txSignature,
            alerted: event.alerted,
          },
        });
      } catch (error) {
        console.error(chalk.red('Failed to persist security event:'), error);
      }
    }
  }
  
  private consoleLog(event: SecurityEvent): void {
    const severityEmoji = {
      'CRITICAL': '🔴',
      'HIGH': '🚨',
      'MEDIUM': '⚠️',
      'LOW': 'ℹ️',
    }[event.severity];
    
    const severityColor = {
      'CRITICAL': chalk.red,
      'HIGH': chalk.magenta,
      'MEDIUM': chalk.yellow,
      'LOW': chalk.blue,
    }[event.severity];
    
    console.log(
      severityColor.bold(`${severityEmoji} [SECURITY:${event.severity}]`),
      chalk.gray(`[${event.category}]`),
      event.message
    );
    
    if (event.details && Object.keys(event.details).length > 0) {
      console.log(chalk.gray('  Details:'), event.details);
    }
    
    if (event.txSignature) {
      console.log(chalk.gray('  TX:'), event.txSignature);
    }
  }
  
  private shouldAlert(event: SecurityEvent): boolean {
    // Check if alerts are enabled
    if (process.env.SECURITY_ALERTS_ENABLED === 'false') {
      return false;
    }
    
    // Check severity threshold
    if (SEVERITY_ORDER[event.severity] < SEVERITY_ORDER[this.config.minSeverity]) {
      return false;
    }
    
    // CRITICAL events always alert
    if (event.severity === 'CRITICAL') {
      return true;
    }
    
    // Check rate limiting
    const lastAlert = this.lastAlertTime.get(event.eventType);
    if (lastAlert) {
      const timeSinceLastAlert = Date.now() - lastAlert;
      const rateLimitMs = this.config.rateLimitMinutes * 60 * 1000;
      
      if (timeSinceLastAlert < rateLimitMs) {
        return false;
      }
    }
    
    return true;
  }
  
  private async sendAlerts(event: SecurityEvent): Promise<void> {
    if (this.telegramService) {
      const success = await this.telegramService.sendAlert(event);
      if (!success) {
        console.error(chalk.red(`Failed to send Telegram alert`));
      }
    }
  }
  
  private updateCounters(event: SecurityEvent): void {
    const key = `${event.category}:${event.eventType}`;
    const counter = this.eventCounters.get(key) || { count: 0, firstSeen: Date.now() };
    
    counter.count++;
    this.eventCounters.set(key, counter);
    
    // Clean old counters (older than 1 hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [k, v] of this.eventCounters.entries()) {
      if (v.firstSeen < oneHourAgo && v.count === 1) {
        this.eventCounters.delete(k);
      }
    }
  }
  
  getRecentEvents(limit: number = 100, filters?: EventFilters): SecurityEvent[] {
    let filtered = this.events;
    
    if (filters?.severity) {
      filtered = filtered.filter(e => e.severity === filters.severity);
    }
    
    if (filters?.category) {
      filtered = filtered.filter(e => e.category === filters.category);
    }
    
    if (filters?.eventType) {
      filtered = filtered.filter(e => e.eventType === filters.eventType);
    }
    
    if (filters?.since) {
      const sinceTime = new Date(filters.since).getTime();
      filtered = filtered.filter(e => e.timestamp.getTime() > sinceTime);
    }
    
    return filtered.slice(0, limit);
  }
  
  getStats(): SecurityStats {
    const now = Date.now();
    const last24Hours = now - 86400000;
    const lastHour = now - 3600000;
    
    const bySeverity: Record<SecuritySeverity, number> = {
      'LOW': 0,
      'MEDIUM': 0,
      'HIGH': 0,
      'CRITICAL': 0,
    };
    
    const byCategory: Record<string, number> = {};
    const byEventType: Record<string, number> = {};
    
    let criticalUnresolved = 0;
    let events24h = 0;
    let eventsHour = 0;
    
    for (const event of this.events) {
      bySeverity[event.severity]++;
      
      byCategory[event.category] = (byCategory[event.category] || 0) + 1;
      byEventType[event.eventType] = (byEventType[event.eventType] || 0) + 1;
      
      const eventTime = event.timestamp.getTime();
      if (eventTime > last24Hours) events24h++;
      if (eventTime > lastHour) eventsHour++;
      
      if (event.severity === 'CRITICAL') {
        criticalUnresolved++;
      }
    }
    
    return {
      total: this.events.length,
      bySeverity,
      byCategory,
      byEventType,
      last24Hours: events24h,
      lastHour: eventsHour,
      criticalUnresolved,
    };
  }
  
  async testAlerts(): Promise<AlertTestResult> {
    const testEvent: SecurityEvent = {
      id: 'test-' + uuidv4(),
      timestamp: new Date(),
      severity: 'HIGH',
      category: 'Admin',
      eventType: 'TEST_ALERT',
      message: 'This is a test security alert from the Memecoin Lending Protocol',
      details: {
        test: true,
        timestamp: new Date().toISOString(),
        source: 'Manual test',
      },
      source: 'security-monitor',
      alerted: true,
    };
    
    const results: AlertTestResult = {};
    
    if (this.telegramService) {
      try {
        const success = await this.telegramService.sendAlert(testEvent);
        results.telegram = { success };
      } catch (error: any) {
        results.telegram = { success: false, error: error.message };
      }
    }
    
    return results;
  }
  
  getConfig(): AlertConfig {
    return { ...this.config };
  }
  
  async resolveEvent(id: string, resolvedBy: string, notes?: string): Promise<void> {
    const event = this.events.find(e => e.id === id);
    if (event) {
      // Update in memory
      (event as any).resolved = true;
      (event as any).resolvedAt = new Date();
      (event as any).resolvedBy = resolvedBy;
      (event as any).notes = notes;
    }
    
    // Update in database if persisted
    if (process.env.SECURITY_PERSIST_TO_DB === 'true') {
      await prisma.securityEvent.update({
        where: { id },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy,
          notes,
        },
      });
    }
  }
  
  // Legacy method for backwards compatibility
  async logSecurityEvent(params: {
    severity: SecuritySeverity;
    category: string;
    message: string;
    details: Record<string, any>;
    source: string;
  }): Promise<void> {
    await this.log({
      severity: params.severity,
      category: params.category as SecurityCategory,
      eventType: params.message.replace(/\s+/g, '_').toUpperCase(),
      message: params.message,
      details: params.details,
      source: params.source,
    });
  }
}

// Export singleton instance
export const securityMonitor = new SecurityMonitorService();