import { query } from '../config/database';
import { logger } from '../utils/logger';
import {
  IOrder,
  IOrderLog,
  IOrderRequest,
  OrderStatus,
  OrderType,
  DexProvider,
} from '../types';

/**
 * Raw database row type (snake_case from PostgreSQL)
 */
interface OrderRow {
  id: string;
  status: OrderStatus;
  type: OrderType;
  token_in: string;
  token_out: string;
  amount_in: string;
  slippage: string;
  amount_out: string | null;
  dex_used: DexProvider | null;
  tx_hash: string | null;
  failure_reason: string | null;
  raydium_quote: string | null;
  meteora_quote: string | null;
  logs: IOrderLog[];
  created_at: string;
  updated_at: string;
}

/**
 * Order Repository - Data access layer for orders
 * Follows Single Responsibility: only handles DB operations
 */

/**
 * Create a new order
 */
export const createOrder = async (
  id: string,
  request: IOrderRequest
): Promise<IOrder> => {
  const sql = `
    INSERT INTO orders (id, type, token_in, token_out, amount_in, slippage, status, logs)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const initialLog: IOrderLog = {
    stage: OrderStatus.PENDING,
    timestamp: new Date().toISOString(),
  };

  const rows = await query<OrderRow>(sql, [
    id,
    request.type,
    request.tokenIn,
    request.tokenOut,
    request.amount,
    request.slippage,
    OrderStatus.PENDING,
    JSON.stringify([initialLog]),
  ]);

  logger.info({ orderId: id }, 'Order created');
  return mapRowToOrder(rows[0]!);
};

/**
 * Get order by ID
 */
export const getOrderById = async (id: string): Promise<IOrder | null> => {
  const sql = `SELECT * FROM orders WHERE id = $1`;
  const rows = await query<OrderRow>(sql, [id]);
  
  if (rows.length === 0) {
    return null;
  }
  
  return mapRowToOrder(rows[0]!);
};

/**
 * Update order status
 */
export const updateOrderStatus = async (
  id: string,
  status: OrderStatus,
  logEntry?: Partial<IOrderLog>
): Promise<IOrder | null> => {
  const log: IOrderLog = {
    stage: status,
    timestamp: new Date().toISOString(),
    ...logEntry,
  };

  const sql = `
    UPDATE orders 
    SET status = $2, 
        logs = logs || $3::jsonb
    WHERE id = $1
    RETURNING *
  `;

  const rows = await query<OrderRow>(sql, [id, status, JSON.stringify(log)]);
  
  if (rows.length === 0) {
    return null;
  }

  logger.info({ orderId: id, status }, 'Order status updated');
  return mapRowToOrder(rows[0]!);
};

/**
 * Update order with routing decision
 */
export const updateOrderRouting = async (
  id: string,
  raydiumQuote: string,
  meteoraQuote: string,
  selectedDex: DexProvider
): Promise<IOrder | null> => {
  const log: IOrderLog = {
    stage: OrderStatus.ROUTING,
    timestamp: new Date().toISOString(),
    raydium: raydiumQuote,
    meteora: meteoraQuote,
    selected: selectedDex,
  };

  const sql = `
    UPDATE orders 
    SET status = $2,
        raydium_quote = $3,
        meteora_quote = $4,
        dex_used = $5,
        logs = logs || $6::jsonb
    WHERE id = $1
    RETURNING *
  `;

  const rows = await query<OrderRow>(sql, [
    id,
    OrderStatus.ROUTING,
    raydiumQuote,
    meteoraQuote,
    selectedDex,
    JSON.stringify(log),
  ]);

  return rows.length > 0 ? mapRowToOrder(rows[0]!) : null;
};

/**
 * Update order with execution result (confirmed)
 */
export const updateOrderConfirmed = async (
  id: string,
  txHash: string,
  executedPrice: string,
  amountOut: string
): Promise<IOrder | null> => {
  const log: IOrderLog = {
    stage: OrderStatus.CONFIRMED,
    timestamp: new Date().toISOString(),
    txHash,
    executedPrice,
  };

  const sql = `
    UPDATE orders 
    SET status = $2,
        tx_hash = $3,
        amount_out = $4,
        logs = logs || $5::jsonb
    WHERE id = $1
    RETURNING *
  `;

  const rows = await query<OrderRow>(sql, [
    id,
    OrderStatus.CONFIRMED,
    txHash,
    amountOut,
    JSON.stringify(log),
  ]);

  logger.info({ orderId: id, txHash }, 'Order confirmed');
  return rows.length > 0 ? mapRowToOrder(rows[0]!) : null;
};

/**
 * Update order with failure
 */
export const updateOrderFailed = async (
  id: string,
  failureReason: string,
  attempt?: number,
  maxAttempts?: number
): Promise<IOrder | null> => {
  const log: IOrderLog = {
    stage: OrderStatus.FAILED,
    timestamp: new Date().toISOString(),
    reason: failureReason,
    attempt,
    maxAttempts,
  };

  const sql = `
    UPDATE orders 
    SET status = $2,
        failure_reason = $3,
        logs = logs || $4::jsonb
    WHERE id = $1
    RETURNING *
  `;

  const rows = await query<OrderRow>(sql, [
    id,
    OrderStatus.FAILED,
    failureReason,
    JSON.stringify(log),
  ]);

  logger.warn({ orderId: id, failureReason }, 'Order failed');
  return rows.length > 0 ? mapRowToOrder(rows[0]!) : null;
};

/**
 * Get recent orders (for debugging/admin)
 */
export const getRecentOrders = async (limit: number = 50): Promise<IOrder[]> => {
  const sql = `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`;
  const rows = await query<OrderRow>(sql, [limit]);
  return rows.map(mapRowToOrder);
};

/**
 * Map database row to Order interface
 * Handles snake_case to camelCase conversion
 */
const mapRowToOrder = (row: OrderRow): IOrder => {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    tokenIn: row.token_in,
    tokenOut: row.token_out,
    amountIn: row.amount_in,
    slippage: row.slippage,
    amountOut: row.amount_out ?? undefined,
    dexUsed: row.dex_used ?? undefined,
    txHash: row.tx_hash ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    raydiumQuote: row.raydium_quote ?? undefined,
    meteoraQuote: row.meteora_quote ?? undefined,
    logs: row.logs,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};
