import { vi } from 'vitest';

// 1. Mock Redis
vi.mock('../src/config/redis', () => ({
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
  checkRedisHealth: vi.fn().mockResolvedValue(true),
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    incr: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(0),
    expire: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    multi: vi.fn(() => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]])
    })),
  },
  redisSub: {
    subscribe: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    off: vi.fn(),
  },
  redisPub: {
    publish: vi.fn().mockResolvedValue(1),
  },
}));

// 2. Mock Database
vi.mock('../src/config/database', () => ({
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
  query: vi.fn().mockResolvedValue([{
    id: 'test-order',
    status: 'pending',
    type: 'market',
    token_in: 'SOL',
    token_out: 'USDC',
    amount_in: '1.0',
    slippage: '0.01',
    logs: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }]),
  pool: {
    query: vi.fn(),
    connect: vi.fn(() => ({
      query: vi.fn(),
      release: vi.fn(),
    })),
    end: vi.fn(),
  },
}));

// 3. Mock Queue
vi.mock('../src/lib/queue', () => ({
  enqueueOrder: vi.fn().mockResolvedValue('job-123'),
  isQueueOverloaded: vi.fn().mockResolvedValue(false),
  getQueueHealth: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  closeQueue: vi.fn(),
  ORDER_QUEUE_NAME: 'test-queue',
  ORDER_CHANNEL_PREFIX: 'order:status:',
}));

// 4. Mock Metrics
vi.mock('../src/services/metricsService', () => ({
  metricsService: {
    increment: vi.fn(),
    recordLatency: vi.fn(),
    setQueueDepth: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
  },
}));

// 5. Mock Migrations
vi.mock('../src/db', () => ({
  runMigrations: vi.fn(),
}));

// 6. Mock Models
vi.mock('../src/models/order', () => ({
  createOrder: vi.fn(),
  getOrderById: vi.fn().mockResolvedValue({
    id: 'test-order',
    status: 'pending',
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: '1.0',
    slippage: '0.01',
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  updateOrderStatus: vi.fn(),
  updateOrderRouting: vi.fn(),
  updateOrderConfirmed: vi.fn(),
  updateOrderFailed: vi.fn(),
}));
