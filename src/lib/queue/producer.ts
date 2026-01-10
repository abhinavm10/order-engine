import { Queue } from 'bullmq';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { IOrderJobPayload } from '../../types';
import { config } from '../../config';

/**
 * Queue name for order processing
 */
export const ORDER_QUEUE_NAME = 'order-execution';

/**
 * PubSub channel prefix for order status updates
 */
export const ORDER_CHANNEL_PREFIX = 'order:status:';

/**
 * Order execution queue
 */
export const orderQueue = new Queue<IOrderJobPayload>(ORDER_QUEUE_NAME, {
  connection: {
    host: new URL(config.REDIS_URL).hostname,
    port: parseInt(new URL(config.REDIS_URL).port || '6379'),
    password: new URL(config.REDIS_URL).password || undefined,
  },
  defaultJobOptions: {
    attempts: config.MAX_RETRIES,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      count: 5000, // Keep last 5000 failed jobs for debugging
    },
  },
});

/**
 * Add an order job to the queue
 */
export const enqueueOrder = async (payload: IOrderJobPayload): Promise<string> => {
  const job = await orderQueue.add('process-order' as any, payload, {
    jobId: payload.orderId, // Use orderId as jobId for easy lookup
  });

  logger.info({
    orderId: payload.orderId,
    jobId: job.id,
    correlationId: payload.correlationId,
  }, 'Order enqueued');

  return job.id!;
};

/**
 * Get queue health metrics
 */
export const getQueueHealth = async (): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> => {
  const [waiting, active, completed, failed] = await Promise.all([
    orderQueue.getWaitingCount(),
    orderQueue.getActiveCount(),
    orderQueue.getCompletedCount(),
    orderQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
};

/**
 * Check if queue depth exceeds threshold (for backpressure)
 */
export const isQueueOverloaded = async (threshold: number = 100): Promise<boolean> => {
  const waiting = await orderQueue.getWaitingCount();
  return waiting > threshold;
};

/**
 * Close queue connection gracefully
 */
export const closeQueue = async (): Promise<void> => {
  await orderQueue.close();
  logger.info('Order queue closed');
};
