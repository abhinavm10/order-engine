import { Pool, PoolClient } from 'pg';
import { config } from './index';
import { logger } from '../utils/logger';

/**
 * PostgreSQL connection pool
 * Pool manages multiple connections efficiently
 */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail if can't connect in 5s
});

// Pool event handlers
pool.on('connect', () => {
  logger.debug('New PostgreSQL connection established');
});

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error');
});

pool.on('remove', () => {
  logger.debug('PostgreSQL connection removed from pool');
});

/**
 * Execute a query with automatic connection handling
 */
export const query = async <T>(
  text: string,
  params?: unknown[]
): Promise<T[]> => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ query: text, duration, rows: result.rowCount }, 'Query executed');
    return result.rows as T[];
  } catch (err) {
    logger.error({ err, query: text }, 'Query failed');
    throw err;
  }
};

/**
 * Get a client from the pool for transactions
 */
export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  return client;
};

/**
 * Execute a transaction with automatic commit/rollback
 */
export const transaction = async <T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Connect to PostgreSQL (test connection)
 */
export const connectDatabase = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    logger.info({ serverTime: result.rows[0]?.now }, 'PostgreSQL connected');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to PostgreSQL');
    throw err;
  }
};

/**
 * Disconnect from PostgreSQL
 */
export const disconnectDatabase = async (): Promise<void> => {
  try {
    await pool.end();
    logger.info('PostgreSQL pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing PostgreSQL pool');
  }
};

/**
 * Health check for PostgreSQL
 */
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
};
