import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../utils/logger';

/**
 * Redis client for general operations (caching, idempotency, rate limiting)
 */
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error('Redis connection failed after 3 retries');
      return null; // Stop retrying
    }
    return Math.min(times * 200, 2000); // Exponential backoff
  },
  lazyConnect: true,
});

/**
 * Separate Redis connection for PubSub (subscriber)
 * PubSub requires dedicated connection as it blocks
 */
export const redisSub = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

/**
 * Separate Redis connection for PubSub (publisher)
 */
export const redisPub = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

// Connection event handlers
redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis client error');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redisSub.on('connect', () => {
  logger.info('Redis subscriber connected');
});

redisPub.on('connect', () => {
  logger.info('Redis publisher connected');
});

/**
 * Connect all Redis clients
 */
export const connectRedis = async (): Promise<void> => {
  try {
    await Promise.all([
      redis.connect(),
      redisSub.connect(),
      redisPub.connect(),
    ]);
    logger.info('All Redis connections established');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Redis');
    throw err;
  }
};

/**
 * Disconnect all Redis clients gracefully
 */
export const disconnectRedis = async (): Promise<void> => {
  try {
    await Promise.all([
      redis.quit(),
      redisSub.quit(),
      redisPub.quit(),
    ]);
    logger.info('All Redis connections closed');
  } catch (err) {
    logger.error({ err }, 'Error closing Redis connections');
  }
};

/**
 * Health check for Redis
 */
export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
};
