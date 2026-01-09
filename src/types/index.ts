/**
 * Order Status Enum
 * Represents the lifecycle of an order
 */
export enum OrderStatus {
  PENDING = 'pending',
  ROUTING = 'routing',
  BUILDING = 'building',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

/**
 * Order Type Enum
 * V1 supports only market orders
 */
export enum OrderType {
  MARKET = 'market',
  // LIMIT = 'limit',      // Future
  // SNIPER = 'sniper',    // Future
}

/**
 * DEX Provider Enum
 */
export enum DexProvider {
  RAYDIUM = 'raydium',
  METEORA = 'meteora',
}

/**
 * Error Codes for consistent error handling
 */
export enum ErrorCode {
  // Validation errors (4xx)
  INVALID_BODY = 'invalid_body',
  NOT_FOUND = 'not_found',
  IDEMPOTENCY_CONFLICT = 'idempotency_conflict',
  RATE_LIMITED = 'rate_limited',
  QUEUE_FULL = 'queue_full',

  // Server errors (5xx)
  SERVICE_UNAVAILABLE = 'service_unavailable',
  INTERNAL_ERROR = 'internal_error',

  // Business logic errors
  SLIPPAGE_EXCEEDED = 'slippage_exceeded',
  EXECUTION_FAILED = 'execution_failed',
  TIMEOUT = 'timeout',
}

/**
 * Order Request - what the client sends
 */
export interface IOrderRequest {
  type: OrderType;
  tokenIn: string;
  tokenOut: string;
  amount: string; // String to preserve decimal precision
  slippage: string; // e.g., "0.01" for 1%
}

/**
 * Order Entity - stored in database
 */
export interface IOrder {
  id: string;
  status: OrderStatus;
  type: OrderType;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: string;
  amountOut?: string;
  dexUsed?: DexProvider;
  txHash?: string;
  failureReason?: string;
  raydiumQuote?: string;
  meteoraQuote?: string;
  logs: IOrderLog[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Order Log Entry - stored in JSONB logs column
 */
export interface IOrderLog {
  stage: OrderStatus;
  timestamp: string;
  dex?: DexProvider;
  raydium?: string;
  meteora?: string;
  selected?: DexProvider;
  reason?: string;
  txHash?: string;
  executedPrice?: string;
  error?: string;
  attempt?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
}

/**
 * DEX Quote Response
 */
export interface IDexQuote {
  dex: DexProvider;
  price: string;
  fee: string;
}

/**
 * Swap Execution Result
 */
export interface ISwapResult {
  txHash: string;
  executedPrice: string;
  dex: DexProvider;
}

/**
 * WebSocket Event Payload
 */
export interface IWsEvent {
  orderId: string;
  status: OrderStatus;
  timestamp: string;
  dex?: DexProvider;
  quote?: string;
  txHash?: string;
  executedPrice?: string;
  error?: string;
  failureReason?: string;
  attempt?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
  logs?: IOrderLog[];
}

/**
 * API Error Response
 */
export interface IApiError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * API Success Response for order creation
 */
export interface IOrderResponse {
  success: true;
  orderId: string;
}

/**
 * Job Payload for BullMQ queue
 */
export interface IOrderJobPayload {
  orderId: string;
  request: IOrderRequest;
  correlationId: string;
}
