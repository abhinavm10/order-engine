import { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { orderController } from '../controllers';
import { webSocketService } from '../services';
import { idempotencyMiddleware, rateLimitMiddleware, backpressureMiddleware } from '../middleware';
import { logger } from '../utils/logger';

/**
 * Order routes - HTTP and WebSocket endpoints
 */
export const orderRoutes = async (app: FastifyInstance): Promise<void> => {
  // Register WebSocket plugin
  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 64, // 64KB max message size
    },
  });

  /**
   * POST /api/orders/execute
   * Submit a new order for execution
   * 
   * Middleware chain:
   * 1. Rate limiting (30 req/min per IP)
   * 2. Backpressure (reject if queue overloaded)
   * 3. Idempotency (return cached result if same key+body)
   */
  app.post('/api/orders/execute', {
    preHandler: [
      rateLimitMiddleware,
      backpressureMiddleware,
      idempotencyMiddleware,
    ],
  }, async (request, reply) => {
    return orderController.executeOrder(request, reply);
  });

  /**
   * GET /api/orders/execute (WebSocket)
   * Connect via WebSocket for real-time order status updates
   * 
   * Query params:
   * - orderId: The order ID to subscribe to
   * 
   * Usage:
   * ws://localhost:3000/api/orders/execute?orderId=uuid
   */
  app.get('/api/orders/execute', { websocket: true }, async (socket, request) => {
    const orderId = (request.query as Record<string, string>).orderId;
    const clientIp = request.ip || 
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
      'unknown';

    if (!orderId) {
      logger.warn({ clientIp }, 'WebSocket connection without orderId');
      socket.send(JSON.stringify({
        type: 'error',
        message: 'orderId query parameter is required',
      }));
      socket.close(4000, 'Missing orderId');
      return;
    }

    // Delegate to WebSocket service
    await webSocketService.handleConnection(socket, orderId, clientIp);
  });

  /**
   * GET /api/orders/:orderId
   * Get order status (HTTP polling fallback)
   */
  app.get<{ Params: { orderId: string } }>('/api/orders/:orderId', async (request, reply) => {
    return orderController.getOrder(request, reply);
  });
};
