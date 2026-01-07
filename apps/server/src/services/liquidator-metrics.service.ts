import { Redis } from 'ioredis';
import { hostname } from 'os';
import { securityMonitor } from './security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';

export interface LiquidatorMetrics {
  instanceId: string;
  lastSuccessfulRun: Date | null;
  consecutiveFailures: number;
  totalLiquidations24h: number;
  totalChecks24h: number;
  avgProcessingTimeMs: number;
  isHealthy: boolean;
  lastHeartbeat: Date;
}

interface ProcessingTimeSample {
  timestamp: number;
  duration: number;
}

class LiquidatorMetricsService {
  private redis: Redis | null = null;
  private instanceId: string;
  private processingTimes: ProcessingTimeSample[] = [];
  private readonly INSTANCE_TTL = 3600; // 1 hour TTL for instance registration
  private readonly METRICS_KEY_PREFIX = 'liquidator:metrics:';
  private readonly GLOBAL_KEY = 'liquidator:metrics:global';
  private readonly MAX_PROCESSING_TIME_SAMPLES = 100;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly CONSECUTIVE_FAILURE_THRESHOLD = 3;
  private readonly NO_RUN_ALERT_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastAlertTime: number = 0;
  private readonly ALERT_COOLDOWN = 5 * 60 * 1000; // 5 minutes between alerts

  constructor() {
    // Generate unique instance ID
    this.instanceId = process.env.INSTANCE_ID || this.generateInstanceId();
    console.log(`🔍 Liquidator metrics initialized with instance ID: ${this.instanceId}`);
  }

  private generateInstanceId(): string {
    const host = hostname();
    const pid = process.pid;
    const random = Math.random().toString(36).substring(2, 8);
    return `${host}-${pid}-${random}`;
  }

  initialize(redisInstance: Redis): void {
    this.redis = redisInstance;
    this.startHealthChecks();
    console.log('✅ Liquidator metrics service initialized');
  }

  private startHealthChecks(): void {
    // Initial heartbeat
    this.updateHeartbeat();
    
    // Periodic heartbeat
    this.healthCheckInterval = setInterval(() => {
      this.updateHeartbeat();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private async updateHeartbeat(): Promise<void> {
    if (!this.redis) return;
    
    const key = `${this.METRICS_KEY_PREFIX}${this.instanceId}`;
    const metrics = await this.getCurrentMetrics();
    
    await this.redis.setex(
      key,
      this.INSTANCE_TTL,
      JSON.stringify({
        ...metrics,
        lastHeartbeat: new Date()
      })
    );
  }

  async recordJobStart(): Promise<number> {
    return Date.now();
  }

  async recordJobSuccess(startTime: number, liquidationCount: number = 0): Promise<void> {
    const duration = Date.now() - startTime;
    
    // Update processing time samples
    this.processingTimes.push({
      timestamp: Date.now(),
      duration
    });
    
    // Keep only recent samples
    if (this.processingTimes.length > this.MAX_PROCESSING_TIME_SAMPLES) {
      this.processingTimes = this.processingTimes.slice(-this.MAX_PROCESSING_TIME_SAMPLES);
    }
    
    // Update instance metrics
    const metrics = await this.getCurrentMetrics();
    metrics.lastSuccessfulRun = new Date();
    metrics.consecutiveFailures = 0;
    metrics.avgProcessingTimeMs = this.calculateAvgProcessingTime();
    
    await this.saveMetrics(metrics);
    
    // Update global counters
    if (this.redis) {
      await this.redis.hincrby(this.GLOBAL_KEY, 'totalChecks24h', 1);
      if (liquidationCount > 0) {
        await this.redis.hincrby(this.GLOBAL_KEY, 'totalLiquidations24h', liquidationCount);
      }
    }
    
    console.log(`✅ Liquidation job completed in ${duration}ms, ${liquidationCount} liquidations`);
  }

  async recordJobFailure(error: Error): Promise<void> {
    const metrics = await this.getCurrentMetrics();
    metrics.consecutiveFailures++;
    
    await this.saveMetrics(metrics);
    
    // Check if we should alert
    if (metrics.consecutiveFailures >= this.CONSECUTIVE_FAILURE_THRESHOLD) {
      await this.triggerFailureAlert(metrics.consecutiveFailures, error);
    }
    
    console.error(`❌ Liquidation job failed (${metrics.consecutiveFailures} consecutive failures):`, error.message);
  }

  private calculateAvgProcessingTime(): number {
    if (this.processingTimes.length === 0) return 0;
    
    const sum = this.processingTimes.reduce((acc, sample) => acc + sample.duration, 0);
    return Math.round(sum / this.processingTimes.length);
  }

  private async getCurrentMetrics(): Promise<LiquidatorMetrics> {
    if (!this.redis) {
      return this.getDefaultMetrics();
    }
    
    const key = `${this.METRICS_KEY_PREFIX}${this.instanceId}`;
    const data = await this.redis.get(key);
    
    if (data) {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        lastSuccessfulRun: parsed.lastSuccessfulRun ? new Date(parsed.lastSuccessfulRun) : null,
        lastHeartbeat: new Date(parsed.lastHeartbeat)
      };
    }
    
    return this.getDefaultMetrics();
  }

  private getDefaultMetrics(): LiquidatorMetrics {
    return {
      instanceId: this.instanceId,
      lastSuccessfulRun: null,
      consecutiveFailures: 0,
      totalLiquidations24h: 0,
      totalChecks24h: 0,
      avgProcessingTimeMs: 0,
      isHealthy: true,
      lastHeartbeat: new Date()
    };
  }

  private async saveMetrics(metrics: LiquidatorMetrics): Promise<void> {
    if (!this.redis) return;
    
    const key = `${this.METRICS_KEY_PREFIX}${this.instanceId}`;
    await this.redis.setex(
      key,
      this.INSTANCE_TTL,
      JSON.stringify({
        ...metrics,
        lastHeartbeat: new Date()
      })
    );
  }

  async getInstanceHealth(): Promise<LiquidatorMetrics> {
    const metrics = await this.getCurrentMetrics();
    const now = Date.now();
    
    // Check if instance is healthy
    metrics.isHealthy = this.checkHealthStatus(metrics, now);
    
    // Check if we need to alert for no successful runs
    if (metrics.lastSuccessfulRun) {
      const timeSinceLastRun = now - metrics.lastSuccessfulRun.getTime();
      if (timeSinceLastRun > this.NO_RUN_ALERT_THRESHOLD) {
        await this.triggerNoRunAlert(timeSinceLastRun);
      }
    }
    
    return metrics;
  }

  private checkHealthStatus(metrics: LiquidatorMetrics, now: number): boolean {
    // Check consecutive failures
    if (metrics.consecutiveFailures >= this.CONSECUTIVE_FAILURE_THRESHOLD) {
      return false;
    }
    
    // Check last successful run
    if (metrics.lastSuccessfulRun) {
      const timeSinceLastRun = now - metrics.lastSuccessfulRun.getTime();
      if (timeSinceLastRun > this.NO_RUN_ALERT_THRESHOLD) {
        return false;
      }
    }
    
    // Check heartbeat (instance might be dead)
    const timeSinceHeartbeat = now - metrics.lastHeartbeat.getTime();
    if (timeSinceHeartbeat > this.HEALTH_CHECK_INTERVAL * 3) {
      return false;
    }
    
    return true;
  }

  async getAllInstancesHealth(): Promise<LiquidatorMetrics[]> {
    if (!this.redis) {
      return [await this.getInstanceHealth()];
    }
    
    // Get all instance keys
    const keys = await this.redis.keys(`${this.METRICS_KEY_PREFIX}*`);
    const instances: LiquidatorMetrics[] = [];
    
    for (const key of keys) {
      // Skip global key
      if (key === this.GLOBAL_KEY) continue;
      
      const data = await this.redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        const metrics: LiquidatorMetrics = {
          ...parsed,
          lastSuccessfulRun: parsed.lastSuccessfulRun ? new Date(parsed.lastSuccessfulRun) : null,
          lastHeartbeat: new Date(parsed.lastHeartbeat)
        };
        
        metrics.isHealthy = this.checkHealthStatus(metrics, Date.now());
        instances.push(metrics);
      }
    }
    
    return instances;
  }

  async getGlobalMetrics(): Promise<{ totalLiquidations24h: number; totalChecks24h: number }> {
    if (!this.redis) {
      return { totalLiquidations24h: 0, totalChecks24h: 0 };
    }
    
    const data = await this.redis.hgetall(this.GLOBAL_KEY);
    return {
      totalLiquidations24h: parseInt(data.totalLiquidations24h || '0', 10),
      totalChecks24h: parseInt(data.totalChecks24h || '0', 10)
    };
  }

  private async triggerFailureAlert(consecutiveFailures: number, error: Error): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTime < this.ALERT_COOLDOWN) {
      return; // Still in cooldown
    }
    
    this.lastAlertTime = now;
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_FAILURE,
      message: `Liquidator instance ${this.instanceId} has failed ${consecutiveFailures} consecutive times`,
      details: {
        instanceId: this.instanceId,
        consecutiveFailures,
        error: error.message,
        lastSuccessfulRun: (await this.getCurrentMetrics()).lastSuccessfulRun
      },
      source: 'liquidator-metrics'
    });
  }

  private async triggerNoRunAlert(timeSinceLastRun: number): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTime < this.ALERT_COOLDOWN) {
      return; // Still in cooldown
    }
    
    this.lastAlertTime = now;
    const minutesSinceRun = Math.floor(timeSinceLastRun / 60000);
    
    await securityMonitor.log({
      severity: 'HIGH',
      category: 'Liquidation',
      eventType: SECURITY_EVENT_TYPES.LIQUIDATION_FAILURE,
      message: `Liquidator instance ${this.instanceId} hasn't had a successful run in ${minutesSinceRun} minutes`,
      details: {
        instanceId: this.instanceId,
        minutesSinceLastRun: minutesSinceRun,
        lastSuccessfulRun: (await this.getCurrentMetrics()).lastSuccessfulRun
      },
      source: 'liquidator-metrics'
    });
  }

  // Clean up old data (call periodically)
  async cleanupOldMetrics(): Promise<void> {
    if (!this.redis) return;
    
    // Reset 24h counters at midnight (this should be called by a scheduled job)
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      await this.redis.del(this.GLOBAL_KEY);
      console.log('🧹 Reset 24h liquidation counters');
    }
  }

  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    console.log('🛑 Liquidator metrics service shut down');
  }
}

// Export singleton instance
export const liquidatorMetrics = new LiquidatorMetricsService();