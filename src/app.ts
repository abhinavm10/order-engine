import Fastify from 'fastify';
import { config } from './config';
import { logger } from './utils/logger';

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
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
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
 * Start the server
 */
const start = async (): Promise<void> => {
  try {
    logger.info({ config: { port: config.PORT, env: config.NODE_ENV } }, 'Starting server...');
    
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    
    logger.info(`🚀 Server running on http://localhost:${config.PORT}`);
    logger.info(`📊 Environment: ${config.NODE_ENV}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    await app.close();
    logger.info('Server closed');
    process.exit(0);
  } catch (err) {
    logger.error(err, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
