import { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../config/redis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ErrorCode } from '../types';

const RATE_LIMIT_PREFIX = 'ratelimit:';
const WINDOW_SIZE = 60; // 60 seconds window

/**
 * Sliding window rate limiter using Redis
 * Limits requests per IP address
 */
export const rateLimitMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  // Get client IP (support for proxies)
  const clientIp = request.ip || 
    (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
    'unknown';
  
  const redisKey = `${RATE_LIMIT_PREFIX}${clientIp}`;
  const now = Date.now();
  const windowStart = now - (WINDOW_SIZE * 1000);

  try {
    // Use Redis transaction for atomic operations
    const multi = redis.multi();
    
    // Remove old entries outside the window
    multi.zremrangebyscore(redisKey, 0, windowStart);
    
    // Count current requests in window
    multi.zcard(redisKey);
    
    // Add current request
    multi.zadd(redisKey, now, `${now}-${Math.random()}`);
    
    // Set expiry on the key
    multi.expire(redisKey, WINDOW_SIZE);

    const results = await multi.exec();
    
    // Get count from zcard result (index 1)
    const requestCount = (results?.[1]?.[1] as number) || 0;

    // Set rate limit headers
    const remaining = Math.max(0, config.RATE_LIMIT - requestCount - 1);
    reply.header('X-RateLimit-Limit', config.RATE_LIMIT);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil((now + WINDOW_SIZE * 1000) / 1000));

    if (requestCount >= config.RATE_LIMIT) {
      const retryAfter = Math.ceil(WINDOW_SIZE - ((now - windowStart) / 1000));
      
      logger.warn({
        clientIp,
        requestCount,
        limit: config.RATE_LIMIT,
        correlationId: request.id,
      }, 'Rate limit exceeded');

      reply.header('Retry-After', retryAfter);
      reply.status(429).send({
        success: false,
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'Too many requests. Please try again later.',
          details: {
            retryAfter,
            limit: config.RATE_LIMIT,
            window: WINDOW_SIZE,
          },
        },
      });
      return;
    }

  } catch (err) {
    logger.error({ err, clientIp }, 'Rate limit check failed');
    // Don't block request on rate limit failure, just log and continue
  }
};
