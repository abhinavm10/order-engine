import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { validateOrderRequest } from '../schemas';
import { createOrder } from '../models/order';
import { enqueueOrder, isQueueOverloaded } from '../lib/queue';
import { logger } from '../utils/logger';
import { ErrorCode, IOrderRequest, IApiError, IOrderResponse, OrderType } from '../types';

/**
 * Order routes
 */
export const orderRoutes = async (app: FastifyInstance): Promise<void> => {
  /**
   * POST /api/orders/execute
   * Submit a new order for execution
   */
  app.post('/api/orders/execute', async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<IOrderResponse | IApiError> => {
    const correlationId = request.id as string;

    // Validate request body
    const validation = validateOrderRequest(request.body);

    if (!validation.success) {
      logger.warn({ correlationId, errors: validation.errors }, 'Invalid order request');
      
      reply.status(400);
      return {
        success: false,
        error: {
          code: ErrorCode.INVALID_BODY,
          message: 'Invalid request body',
          details: { errors: validation.errors },
        },
      };
    }

    // Check for backpressure
    const overloaded = await isQueueOverloaded();
    if (overloaded) {
      logger.warn({ correlationId }, 'Queue is overloaded');
      
      reply.status(429);
      return {
        success: false,
        error: {
          code: ErrorCode.QUEUE_FULL,
          message: 'Server is currently overloaded. Please try again later.',
        },
      };
    }

    try {
      // Generate order ID
      const orderId = uuidv4();

      // Create order request
      const orderRequest: IOrderRequest = {
        type: validation.data!.type as OrderType,
        tokenIn: validation.data!.tokenIn,
        tokenOut: validation.data!.tokenOut,
        amount: validation.data!.amount,
        slippage: validation.data!.slippage,
      };

      // Create order in database
      await createOrder(orderId, orderRequest);

      // Enqueue order for processing
      await enqueueOrder({
        orderId,
        request: orderRequest,
        correlationId,
      });

      logger.info({ orderId, correlationId }, 'Order created and enqueued');

      reply.status(200);
      return {
        success: true,
        orderId,
      };
    } catch (err) {
      logger.error({ err, correlationId }, 'Failed to create order');

      reply.status(503);
      return {
        success: false,
        error: {
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Failed to process order. Please try again later.',
        },
      };
    }
  });

  /**
   * GET /api/orders/:orderId
   * Get order status (for polling fallback)
   */
  app.get<{ Params: { orderId: string } }>('/api/orders/:orderId', async (
    request: FastifyRequest<{ Params: { orderId: string } }>,
    reply: FastifyReply
  ) => {
    const { orderId } = request.params;

    // Import here to avoid circular dependency
    const { getOrderById } = await import('../models/order');
    const order = await getOrderById(orderId);

    if (!order) {
      reply.status(404);
      return {
        success: false,
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Order not found',
        },
      };
    }

    return {
      success: true,
      order,
    };
  });
};
