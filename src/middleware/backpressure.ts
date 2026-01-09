import { FastifyRequest, FastifyReply } from 'fastify';
import { isQueueOverloaded, getQueueHealth } from '../lib/queue';
import { logger } from '../utils/logger';
import { ErrorCode } from '../types';

const QUEUE_DEPTH_THRESHOLD = 100;

/**
 * Backpressure middleware
 * Rejects requests when the queue is overloaded
 */
export const backpressureMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  try {
    const overloaded = await isQueueOverloaded(QUEUE_DEPTH_THRESHOLD);

    if (overloaded) {
      const health = await getQueueHealth();

      logger.warn({
        correlationId: request.id,
        queueHealth: health,
        threshold: QUEUE_DEPTH_THRESHOLD,
      }, 'System overloaded, rejecting request');

      reply.header('Retry-After', 30); // Suggest retry after 30 seconds
      reply.status(503).send({
        success: false,
        error: {
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'System is currently overloaded. Please try again later.',
          details: {
            queueDepth: health.waiting,
            threshold: QUEUE_DEPTH_THRESHOLD,
            retryAfter: 30,
          },
        },
      });
      return;
    }

  } catch (err) {
    logger.error({ err }, 'Backpressure check failed');
    // Don't block request on backpressure check failure
  }
};
