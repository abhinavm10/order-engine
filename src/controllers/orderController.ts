import { FastifyRequest, FastifyReply } from 'fastify';
import { validateOrderRequest } from '../schemas';
import { orderService, metricsService } from '../services';
import { storeIdempotencyResult } from '../middleware';
import { logger } from '../utils/logger';
import { ErrorCode, IOrderRequest, IApiError, IOrderResponse, OrderType } from '../types';

/**
 * Order Controller - Request handling layer
 * Follows Single Responsibility: validates input, calls service, formats response
 */
export class OrderController {
  /**
   * Handle POST /api/orders/execute
   */
  async executeOrder(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<IOrderResponse | IApiError> {
    const correlationId = request.id as string;

    // Get idempotency info from middleware (if present)
    const idempotencyKey = (request as unknown as Record<string, unknown>).idempotencyKey as string | undefined;
    const idempotencyBodyHash = (request as unknown as Record<string, unknown>).idempotencyBodyHash as string | undefined;

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

    try {
      // Create order request
      const orderRequest: IOrderRequest = {
        type: validation.data!.type as OrderType,
        tokenIn: validation.data!.tokenIn,
        tokenOut: validation.data!.tokenOut,
        amount: validation.data!.amount,
        slippage: validation.data!.slippage,
      };

      // Submit order via service
      const { orderId } = await orderService.submitOrder(orderRequest, correlationId);
      metricsService.increment('orders_total');

      // Store idempotency result if key was provided
      if (idempotencyKey && idempotencyBodyHash) {
        await storeIdempotencyResult(idempotencyKey, idempotencyBodyHash, orderId);
      }

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
  }

  /**
   * Handle GET /api/orders/:orderId
   */
  async getOrder(
    request: FastifyRequest<{ Params: { orderId: string } }>,
    reply: FastifyReply
  ) {
    const { orderId } = request.params;

    const order = await orderService.getOrder(orderId);

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
  }
}

// Export singleton instance
export const orderController = new OrderController();
