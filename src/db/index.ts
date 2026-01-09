import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Run database migrations
 * In production, use a proper migration tool like node-pg-migrate
 */
export const runMigrations = async (): Promise<void> => {
  const client = await pool.connect();
  
  try {
    logger.info('Running database migrations...');
    
    // Read migration file
    const migrationPath = join(__dirname, 'migrations', '001_create_orders.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    
    // Execute migration
    await client.query(sql);
    
    logger.info('Migrations completed successfully');
  } catch (err) {
    // Check if error is because objects already exist (idempotent)
    const error = err as { code?: string };
    if (error.code === '42710' || error.code === '42P07') {
      logger.info('Migrations already applied, skipping...');
    } else {
      logger.error({ err }, 'Migration failed');
      throw err;
    }
  } finally {
    client.release();
  }
};
