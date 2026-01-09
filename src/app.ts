import Fastify from 'fastify';
import { config } from './config';
import { logger } from './utils/logger';
import { connectRedis, disconnectRedis, checkRedisHealth } from './config/redis';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from './config/database';
import { runMigrations } from './db';

/**
 * Create and configure Fastify instance
 */
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

// Health check endpoint - used by Docker and load balancers
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
    
    // Start HTTP server
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    
    logger.info(`🚀 Server running on http://localhost:${config.PORT}`);
    logger.info(`📊 Environment: ${config.NODE_ENV}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
};

/**
 * Graceful shutdown - close all connections
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Close HTTP server first (stop accepting new requests)
    await app.close();
    logger.info('HTTP server closed');
    
    // Close database connections
    await disconnectDatabase();
    
    // Close Redis connections
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

start();
