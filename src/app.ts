import Fastify, { FastifyInstance } from 'fastify';
import { config } from './config';
import { logger } from './utils/logger';
import { connectRedis, disconnectRedis, checkRedisHealth } from './config/redis';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from './config/database';
import { runMigrations } from './db';
import { orderRoutes } from './routes';
import { closeQueue, createOrderWorker, closeWorker } from './lib/queue';
import { Worker } from 'bullmq';
import crypto from 'crypto';

// Worker instance for graceful shutdown
let orderWorker: Worker | null = null;

/**
 * Build and configure Fastify instance
 */
export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false, // We use our own Pino logger
    requestIdHeader: 'x-correlation-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Request logging middleware
  app.addHook('onRequest', async (request) => {
    logger.info({
      method: request.method,
      url: request.url,
      correlationId: request.id,
    }, 'Incoming request');
  });

  // Response logging middleware
  app.addHook('onResponse', async (request, reply) => {
    logger.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
      correlationId: request.id,
    }, 'Request completed');
  });

  // Health check endpoint
  app.get('/health', async () => {
    const [redisHealthy, dbHealthy] = await Promise.all([
      checkRedisHealth(),
      checkDatabaseHealth(),
    ]);

    const status = redisHealthy && dbHealthy ? 'ok' : 'degraded';
    
    return {
      status,
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      services: {
        redis: redisHealthy ? 'healthy' : 'unhealthy',
        postgres: dbHealthy ? 'healthy' : 'unhealthy',
      },
    };
  });

  // Root endpoint
  app.get('/', async () => {
    return {
      message: 'Order Execution Engine API',
      version: '1.0.0',
      docs: '/docs',
    };
  });

  // Register routes
  await app.register(orderRoutes);

  return app;
};

/**
 * Start the server with all connections
 */
const start = async (): Promise<void> => {
  try {
    logger.info({ config: { port: config.PORT, env: config.NODE_ENV } }, 'Starting server...');
    
    // Connect to services
    logger.info('Connecting to Redis...');
    await connectRedis();
    
    logger.info('Connecting to PostgreSQL...');
    await connectDatabase();
    
    // Run database migrations
    logger.info('Running migrations...');
    await runMigrations();
    
    // Build app
    const app = await buildApp();
    
    // Start HTTP server
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    
    logger.info(`🚀 Server running on http://localhost:${config.PORT}`);
    logger.info(`📊 Environment: ${config.NODE_ENV}`);

    // Start the order worker in the same process
    logger.info('Starting order worker...');
    orderWorker = createOrderWorker();
    logger.info('🔧 Worker is running and processing orders');

    // Graceful shutdown handling (inside start scope)
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        await app.close();
        logger.info('HTTP server closed');
        if (orderWorker) {
          await closeWorker(orderWorker);
          logger.info('Order worker closed');
        }
        await closeQueue();
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error(err, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
};

// Only run start if called directly
if (require.main === module) {
  start();
}
