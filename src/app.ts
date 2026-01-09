import Fastify from 'fastify';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Health check endpoint
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Placeholder for order routes
app.get('/', async () => {
  return { message: 'Order Execution Engine API', version: '1.0.0' };
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
