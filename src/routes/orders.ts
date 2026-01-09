import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { orderController } from '../controllers';
import { idempotencyMiddleware, rateLimitMiddleware, backpressureMiddleware } from '../middleware';

/**
 * Order routes - Thin layer that delegates to controller
 */
export const orderRoutes = async (app: FastifyInstance): Promise<void> => {
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
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return orderController.executeOrder(request, reply);
  });

  /**
   * GET /api/orders/:orderId
   * Get order status
   */
  app.get<{ Params: { orderId: string } }>('/api/orders/:orderId', async (
    request: FastifyRequest<{ Params: { orderId: string } }>,
    reply: FastifyReply
  ) => {
    return orderController.getOrder(request, reply);
  });
};
