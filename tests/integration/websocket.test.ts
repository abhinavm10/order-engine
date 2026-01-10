import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketService } from '../../src/services/webSocketService';
import { getOrderById } from '../../src/models/order';

describe('WebSocketService', () => {
  let service: WebSocketService;
  let mockSocket: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WebSocketService();
    mockSocket = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      terminate: vi.fn(),
      ping: vi.fn(),
      readyState: 1, // OPEN
    };

    // Override the global mock for getOrderById for specific WebSocket tests
    vi.mocked(getOrderById).mockResolvedValue({
      id: 'test-order',
      status: 'pending' as any,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: '1.0',
      slippage: '0.01',
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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
      // Smoke test for method execution
      expect(mockSocket.on).toHaveBeenCalledWith('pong', expect.any(Function));
    });
  });
});