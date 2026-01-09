import { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { ErrorCode } from '../types';
import crypto from 'crypto';

const IDEMPOTENCY_PREFIX = 'idempotency:';
const IDEMPOTENCY_TTL = 300; // 5 minutes

/**
 * Idempotency data stored in Redis
 */
interface IdempotencyData {
  orderId: string;
  bodyHash: string;
  createdAt: string;
}

/**
 * Generate hash of request body for comparison
 */
const hashBody = (body: unknown): string => {
  const str = JSON.stringify(body);
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Idempotency middleware for order execution
 * 
 * - If Idempotency-Key header is present:
 *   - Check Redis for existing key
 *   - If exists with same body hash: return cached orderId
 *   - If exists with different body hash: return 409 Conflict
 *   - If not exists: proceed and store after success
 */
export const idempotencyMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    // No idempotency key provided, proceed normally
    return;
  }

  const redisKey = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;
  const bodyHash = hashBody(request.body);

  try {
    const existing = await redis.get(redisKey);

    if (existing) {
      const data: IdempotencyData = JSON.parse(existing);

      // Check if body matches
      if (data.bodyHash !== bodyHash) {
        logger.warn({
          idempotencyKey,
          correlationId: request.id,
        }, 'Idempotency key reused with different body');

        reply.status(409).send({
          success: false,
          error: {
            code: ErrorCode.IDEMPOTENCY_CONFLICT,
            message: 'Idempotency key has already been used with a different request body',
          },
        });
        return;
      }

      // Same body, return cached result
      logger.info({
        idempotencyKey,
        orderId: data.orderId,
        correlationId: request.id,
      }, 'Returning cached idempotent response');

      reply.status(200).send({
        success: true,
        orderId: data.orderId,
      });
      return;
    }

    // Store idempotency key and body hash for later
    // We'll update this with orderId after successful creation
    (request as unknown as Record<string, unknown>).idempotencyKey = idempotencyKey;
    (request as unknown as Record<string, unknown>).idempotencyBodyHash = bodyHash;

  } catch (err) {
    logger.error({ err, idempotencyKey }, 'Idempotency check failed');
    // Don't block request on idempotency failure, just log and continue
  }
};

/**
 * Store successful order result for idempotency
 * Call this after order is successfully created
 */
export const storeIdempotencyResult = async (
  idempotencyKey: string,
  bodyHash: string,
  orderId: string
): Promise<void> => {
  const redisKey = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;
  const data: IdempotencyData = {
    orderId,
    bodyHash,
    createdAt: new Date().toISOString(),
  };

  await redis.set(redisKey, JSON.stringify(data), 'EX', IDEMPOTENCY_TTL);
  logger.debug({ idempotencyKey, orderId }, 'Idempotency result stored');
};
