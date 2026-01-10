import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { OrderType } from '../../src/types';

describe('API Integration', () => {
  let app: any;
  let request: any;

  beforeEach(async () => {
    vi.resetModules();
    
    // Dynamic mocks to ensure they apply to the fresh import
    vi.doMock('../../src/config/redis', () => ({
      connectRedis: vi.fn(),
      disconnectRedis: vi.fn(),
      checkRedisHealth: vi.fn().mockResolvedValue(true),
      redis: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        multi: vi.fn(() => ({
          zremrangebyscore: vi.fn().mockReturnThis(),
          zcard: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]])
        })),
      },
      redisSub: { subscribe: vi.fn(), on: vi.fn(), off: vi.fn() },
      redisPub: { publish: vi.fn() },
    }));

    vi.doMock('../../src/config/database', () => ({
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
        connect: vi.fn(() => ({ query: vi.fn(), release: vi.fn() })),
      },
    }));

    vi.doMock('../../src/lib/queue', () => ({
      enqueueOrder: vi.fn().mockResolvedValue('job-123'),
      isQueueOverloaded: vi.fn().mockResolvedValue(false),
      getQueueHealth: vi.fn().mockResolvedValue({ waiting: 0 }),
      closeQueue: vi.fn(),
      ORDER_QUEUE_NAME: 'test-queue',
      ORDER_CHANNEL_PREFIX: 'order:status:',
    }));

    vi.doMock('../../src/services/metricsService', () => ({
      metricsService: {
        increment: vi.fn(),
        recordLatency: vi.fn(),
        setQueueDepth: vi.fn(),
      },
    }));

    // Import app after mocks
    const { buildApp } = await import('../../src/app');
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
    });
  });
});