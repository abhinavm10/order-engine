import { logger } from '../utils/logger';

interface Metrics {
  orders_total: number;
  orders_completed: number;
  orders_failed: number;
  orders_rejected: number; // Backpressure/Rate limit
  quote_latency_sum: number;
  quote_latency_count: number;
  execution_latency_sum: number;
  execution_latency_count: number;
  queue_depth: number;
}

/**
 * Metrics Service - Tracks application KPIs
 */
export class MetricsService {
  private metrics: Metrics = {
    orders_total: 0,
    orders_completed: 0,
    orders_failed: 0,
    orders_rejected: 0,
    quote_latency_sum: 0,
    quote_latency_count: 0,
    execution_latency_sum: 0,
    execution_latency_count: 0,
    queue_depth: 0,
  };

  constructor() {
    // Log metrics every 60 seconds
    setInterval(() => this.logMetrics(), 60000);
  }

  /**
   * Increment counter metric
   */
  increment(metric: keyof Omit<Metrics, 'queue_depth' | 'quote_latency_sum' | 'execution_latency_sum'>): void {
    this.metrics[metric]++;
  }

  /**
   * Record latency metric
   */
  recordLatency(type: 'quote' | 'execution', latencyMs: number): void {
    if (type === 'quote') {
      this.metrics.quote_latency_sum += latencyMs;
      this.metrics.quote_latency_count++;
    } else {
      this.metrics.execution_latency_sum += latencyMs;
      this.metrics.execution_latency_count++;
    }
  }

  /**
   * Set gauge metric
   */
  setQueueDepth(depth: number): void {
    this.metrics.queue_depth = depth;
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): Metrics & { quote_avg_latency: number; execution_avg_latency: number } {
    return {
      ...this.metrics,
      quote_avg_latency: this.metrics.quote_latency_count > 0 
        ? this.metrics.quote_latency_sum / this.metrics.quote_latency_count 
        : 0,
      execution_avg_latency: this.metrics.execution_latency_count > 0 
        ? this.metrics.execution_latency_sum / this.metrics.execution_latency_count 
        : 0,
    };
  }

  /**
   * Log aggregated metrics
   */
  private logMetrics(): void {
    const snapshot = this.getMetrics();
    
    logger.info({
      metrics: {
        orders: {
          total: snapshot.orders_total,
          completed: snapshot.orders_completed,
          failed: snapshot.orders_failed,
          rejected: snapshot.orders_rejected,
          success_rate: snapshot.orders_total > 0 
            ? ((snapshot.orders_completed / snapshot.orders_total) * 100).toFixed(2) + '%' 
            : '0%',
        },
        latency: {
          quote_avg_ms: Math.round(snapshot.quote_avg_latency),
          execution_avg_ms: Math.round(snapshot.execution_avg_latency),
        },
        queue: {
          depth: snapshot.queue_depth,
        },
      }
    }, '📊 Application Metrics (Last 60s snapshot)');
  }
}

// Export singleton instance
export const metricsService = new MetricsService();
