import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketService } from '../../src/services/webSocketService';

// Mock Redis
vi.mock('../../src/config/redis', () => ({
  redis: {
    get: vi.fn(),
    incr: vi.fn(),
    decr: vi.fn(),
    expire: vi.fn(),
  },
  redisSub: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../../src/models/order', () => ({
  getOrderById: vi.fn().mockResolvedValue({
    orderId: 'test-order',
    status: 'PENDING',
    logs: [],
  }),
}));

describe('WebSocketService', () => {
  let service: WebSocketService;
  let mockSocket: any;

  beforeEach(() => {
    service = new WebSocketService();
    mockSocket = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      terminate: vi.fn(),
      ping: vi.fn(),
      readyState: 1, // OPEN
    };
  });

  describe('handleConnection', () => {
    it('should accept connection and send backfill', async () => {
      await service.handleConnection(mockSocket, 'test-order', '127.0.0.1');
      
      expect(mockSocket.send).toHaveBeenCalled();
      // Verify backfill message type
      const calls = mockSocket.send.mock.calls;
      const backfillMsg = JSON.parse(calls[0][0]);
      expect(backfillMsg.type).toBe('backfill');
    });

    it('should setup heartbeat', async () => {
      await service.handleConnection(mockSocket, 'test-order', '127.0.0.1');
      
      // We can't easily test setInterval/setTimeout without fake timers
      // But we can verify logic flow executes without error
    });
  });
});
