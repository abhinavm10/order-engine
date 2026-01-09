import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { IOrderRequest, IOrder, OrderStatus, DexProvider } from '../types';
import { createOrder, getOrderById, updateOrderStatus, updateOrderRouting, updateOrderConfirmed, updateOrderFailed } from '../models/order';
import { enqueueOrder, isQueueOverloaded } from '../lib/queue';
import { dexRouter } from '../lib/dex';

/**
 * Order Service - Business logic for order operations
 * Follows Single Responsibility: handles order business logic only
 */
export class OrderService {
  /**
   * Submit a new order for execution
   */
  async submitOrder(request: IOrderRequest, correlationId: string): Promise<{ orderId: string }> {
    const orderId = uuidv4();

    logger.info({ orderId, correlationId, request }, 'Submitting new order');

    // Create order in database
    await createOrder(orderId, request);

    // Enqueue order for processing
    await enqueueOrder({
      orderId,
      request,
      correlationId,
    });

    logger.info({ orderId, correlationId }, 'Order submitted successfully');

    return { orderId };
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<IOrder | null> {
    return getOrderById(orderId);
  }

  /**
   * Check if the system can accept new orders
   */
  async canAcceptOrders(): Promise<boolean> {
    const overloaded = await isQueueOverloaded();
    return !overloaded;
  }

  /**
   * Process an order (called by worker)
   */
  async processOrder(orderId: string, request: IOrderRequest): Promise<void> {
    logger.info({ orderId }, 'Processing order...');

    // Step 1: Update status to ROUTING
    await updateOrderStatus(orderId, OrderStatus.ROUTING);

    // Step 2: Get quotes from both DEXs
    const { raydium, meteora } = await dexRouter.getQuotes(
      request.tokenIn,
      request.tokenOut,
      request.amount
    );

    // Step 3: Select best DEX
    const { selectedDex, reason } = dexRouter.selectBestDex(raydium, meteora);

    // Update order with routing decision
    await updateOrderRouting(orderId, raydium.price, meteora.price, selectedDex);

    logger.info({ orderId, selectedDex, reason }, 'DEX selected');

    // Step 4: Update status to BUILDING
    await updateOrderStatus(orderId, OrderStatus.BUILDING);

    // Step 5: Execute swap
    const expectedPrice = selectedDex === DexProvider.RAYDIUM ? raydium.price : meteora.price;

    const swapResult = await dexRouter.executeSwap(
      selectedDex,
      request.tokenIn,
      request.tokenOut,
      request.amount,
      expectedPrice,
      request.slippage
    );

    // Step 6: Check slippage
    const slippageCheck = dexRouter.checkSlippage(
      expectedPrice,
      swapResult.executedPrice,
      request.slippage
    );

    if (!slippageCheck.passed) {
      throw new Error(`Slippage exceeded: ${slippageCheck.actualSlippage} > ${request.slippage}`);
    }

    // Step 7: Update status to SUBMITTED
    await updateOrderStatus(orderId, OrderStatus.SUBMITTED, { txHash: swapResult.txHash });

    // Step 8: Update status to CONFIRMED
    const amountOut = (parseFloat(request.amount) * parseFloat(swapResult.executedPrice)).toFixed(9);
    await updateOrderConfirmed(orderId, swapResult.txHash, swapResult.executedPrice, amountOut);

    logger.info({
      orderId,
      txHash: swapResult.txHash,
      executedPrice: swapResult.executedPrice,
      dex: selectedDex,
    }, 'Order completed successfully');
  }

  /**
   * Mark order as failed
   */
  async failOrder(orderId: string, reason: string, attempt?: number, maxAttempts?: number): Promise<void> {
    await updateOrderFailed(orderId, reason, attempt, maxAttempts);
    logger.warn({ orderId, reason, attempt, maxAttempts }, 'Order marked as failed');
  }
}

// Export singleton instance
export const orderService = new OrderService();
