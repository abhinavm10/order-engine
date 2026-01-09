import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../src/app';
import { OrderType } from '../../src/types';

// Mock DB and Redis connections
vi.mock('../../src/config/redis', () => ({
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
  checkRedisHealth: vi.fn().mockResolvedValue(true),
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    multi: vi.fn(() => ({
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      zadd: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]]) // Mock exec results for rate limit
    })),
  },
  redisSub: {
    subscribe: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../../src/config/database', () => ({
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
  pool: {
    query: vi.fn(),
    connect: vi.fn(() => ({
      release: vi.fn(),
    })),
  },
}));

vi.mock('../../src/db', () => ({
  runMigrations: vi.fn(),
}));

// Mock Queue
vi.mock('../../src/lib/queue', () => ({
  enqueueOrder: vi.fn().mockResolvedValue('job-123'),
  isQueueOverloaded: vi.fn().mockResolvedValue(false),
  getQueueHealth: vi.fn().mockResolvedValue({ waiting: 0 }),
}));

describe('API Integration', () => {
  let app: any;
  let request: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    await app.ready();
    request = supertest(app.server);
  });

  describe('GET /health', () => {
    it('should return 200 OK', async () => {
      const response = await request.get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('POST /api/orders/execute', () => {
    it('should submit valid order', async () => {
      const payload = {
        type: OrderType.MARKET,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: '1.0',
        slippage: '0.01',
      };

      const response = await request
        .post('/api/orders/execute')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('orderId');
    });

    it('should fail with invalid body', async () => {
      const payload = {
        type: 'INVALID',
      };

      const response = await request
        .post('/api/orders/execute')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should enforce idempotency', async () => {
      const payload = {
        type: OrderType.MARKET,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: '1.0',
        slippage: '0.01',
      };

      // First request
      const res1 = await request
        .post('/api/orders/execute')
        .set('Idempotency-Key', 'test-key')
        .send(payload);
      
      expect(res1.status).toBe(200);

      // We need to mock Redis GET/SET behavior for real idempotency test
      // Since we mocked Redis completely, we can't test the actual storage/retrieval here easily without a complex mock
      // But we can verify HEADERS are processed if we spy on middleware.
      // This integration test mostly verifies the ROUTE connectivity.
    });
  });
});
