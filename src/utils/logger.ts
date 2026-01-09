import pino from 'pino';
import { config } from '../config';

/**
 * Structured logger using Pino
 * - Uses LOG_LEVEL from config
 * - Pretty prints in development
 * - JSON format in production
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    env: config.NODE_ENV,
  },
});

/**
 * Create a child logger with correlation ID
 * Used to trace requests through the system
 */
export const createChildLogger = (correlationId: string, extra?: Record<string, unknown>) => {
  return logger.child({
    correlationId,
    ...extra,
  });
};

/**
 * Log context for order processing
 */
export const createOrderLogger = (orderId: string, jobId?: string) => {
  return logger.child({
    orderId,
    jobId,
  });
};

export type Logger = typeof logger;
