import { Worker } from 'bullmq';
import { config } from './config';
import { logger } from './utils/logger';
import { connectRedis, disconnectRedis } from './config/redis';
import { connectDatabase, disconnectDatabase } from './config/database';
import { createOrderWorker, closeWorker, closeQueue } from './lib/queue';

let worker: Worker | null = null;

/**
 * Start the worker process
 */
const start = async (): Promise<void> => {
  try {
    logger.info({
      config: {
        env: config.NODE_ENV,
        concurrency: config.QUEUE_CONCURRENCY,
        maxRetries: config.MAX_RETRIES,
      },
    }, 'Starting worker...');

    // Connect to Redis
    logger.info('Connecting to Redis...');
    await connectRedis();

    // Connect to PostgreSQL
    logger.info('Connecting to PostgreSQL...');
    await connectDatabase();

    // Start the order worker
    logger.info('Starting order worker...');
    worker = createOrderWorker();

    logger.info('🔧 Worker is running and processing orders');
  } catch (err) {
    logger.error(err, 'Failed to start worker');
    process.exit(1);
  }
};

/**
 * Graceful shutdown
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down worker...`);

  try {
    // Close worker (waits for active jobs to complete)
    if (worker) {
      await closeWorker(worker);
    }

    // Close queue
    await closeQueue();

    // Close database
    await disconnectDatabase();

    // Close Redis
    await disconnectRedis();

    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error(err, 'Error during worker shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
