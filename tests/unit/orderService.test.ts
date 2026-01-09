import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderService } from '../../src/services/orderService';
import { createOrder, updateOrderStatus, updateOrderRouting, updateOrderConfirmed } from '../../src/models/order';
import { enqueueOrder } from '../../src/lib/queue';
import { dexRouter } from '../../src/lib/dex';
import { metricsService } from '../../src/services/metricsService';
import { OrderStatus, DexProvider, OrderType } from '../../src/types';

// Mock dependencies
vi.mock('../../src/models/order');
vi.mock('../../src/lib/queue');
vi.mock('../../src/lib/dex');
vi.mock('../../src/services/metricsService');
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OrderService', () => {
  let orderService: OrderService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderService = new OrderService();
  });

  describe('submitOrder', () => {
    it('should create order in DB and enqueue it', async () => {
      const request = {
        type: OrderType.MARKET,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: '1.0',
        slippage: '0.01',
      };
      
      const result = await orderService.submitOrder(request, 'test-correlation-id');

      expect(createOrder).toHaveBeenCalledWith(expect.any(String), request);
      expect(enqueueOrder).toHaveBeenCalledWith(expect.objectContaining({
        orderId: result.orderId,
        request,
      }));
      expect(result).toHaveProperty('orderId');
    });
  });

  describe('processOrder', () => {
    it('should execute full order lifecycle successfully', async () => {
      const orderId = 'test-order-id';
      const request = {
        type: OrderType.MARKET,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: '1.0',
        slippage: '0.01',
      };

      // Mock DEX responses
      const mockQuotes = {
        raydium: { dex: DexProvider.RAYDIUM, price: '100', fee: '0.003' },
        meteora: { dex: DexProvider.METEORA, price: '100', fee: '0.002' },
      };
      
      vi.mocked(dexRouter.getQuotes).mockResolvedValue(mockQuotes as any);
      vi.mocked(dexRouter.selectBestDex).mockReturnValue({
        selectedDex: DexProvider.METEORA,
        reason: 'Better price',
      });
      vi.mocked(dexRouter.executeSwap).mockResolvedValue({
        txHash: '0x123',
        executedPrice: '99.9',
        dex: DexProvider.METEORA,
      });
      vi.mocked(dexRouter.checkSlippage).mockReturnValue({
        passed: true,
        actualSlippage: '0.001',
      });

      await orderService.processOrder(orderId, request);

      // Verify status updates
      expect(updateOrderStatus).toHaveBeenCalledWith(orderId, OrderStatus.ROUTING);
      expect(updateOrderRouting).toHaveBeenCalled();
      expect(updateOrderStatus).toHaveBeenCalledWith(orderId, OrderStatus.BUILDING);
      expect(updateOrderStatus).toHaveBeenCalledWith(orderId, OrderStatus.SUBMITTED, expect.anything());
      expect(updateOrderConfirmed).toHaveBeenCalled();
      expect(metricsService.increment).toHaveBeenCalledWith('orders_completed');
    });

    it('should throw error if slippage check fails', async () => {
      const orderId = 'test-order-id';
      const request = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: '1.0',
        slippage: '0.001', // Very tight slippage
      } as any;

      // Mock failure scenario
      vi.mocked(dexRouter.getQuotes).mockResolvedValue({} as any);
      vi.mocked(dexRouter.selectBestDex).mockReturnValue({ selectedDex: DexProvider.RAYDIUM } as any);
      vi.mocked(dexRouter.executeSwap).mockResolvedValue({ executedPrice: '90' } as any); // Huge drop
      vi.mocked(dexRouter.checkSlippage).mockReturnValue({
        passed: false,
        actualSlippage: '0.1',
      });

      await expect(orderService.processOrder(orderId, request))
        .rejects.toThrow('Slippage exceeded');
        
      expect(updateOrderConfirmed).not.toHaveBeenCalled();
    });
  });
});
