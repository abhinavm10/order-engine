import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Environment schema with validation
 * All environment variables are validated at startup
 */
const envSchema = z.object({
  // Server
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url().default('postgres://abhinav:password@localhost:5432/order_engine'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Queue
  QUEUE_CONCURRENCY: z.string().default('10').transform(Number),
  MAX_RETRIES: z.string().default('3').transform(Number),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Mock DEX
  MOCK_SEED: z.string().optional(),

  // Rate Limiting
  RATE_LIMIT: z.string().default('30').transform(Number),

  // WebSocket
  PING_INTERVAL: z.string().default('20000').transform(Number),
  PONG_TIMEOUT: z.string().default('10000').transform(Number),
});

// Parse and validate environment variables
const parseEnv = (): z.infer<typeof envSchema> => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
};

// Export typed config object
export const config = parseEnv();

// Type export for use in other modules
export type Config = typeof config;
