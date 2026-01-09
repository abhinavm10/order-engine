import { Worker, Job } from 'bullmq';
import { config } from '../../config';
import { logger, createOrderLogger } from '../../utils/logger';
import { IOrderJobPayload, OrderStatus, DexProvider } from '../../types';
import { ORDER_QUEUE_NAME, ORDER_CHANNEL_PREFIX } from './producer';
import { redisPub } from '../../config/redis';
import {
  updateOrderStatus,
  updateOrderRouting,
  updateOrderConfirmed,
  updateOrderFailed,
} from '../../models/order';
import { dexRouter } from '../dex';

/**
 * Publish order status update via Redis PubSub
 */
const publishStatus = async (orderId: string, status: OrderStatus, data?: Record<string, unknown>): Promise<void> => {
  const channel = `${ORDER_CHANNEL_PREFIX}${orderId}`;
  const payload = JSON.stringify({
    orderId,
    status,
    timestamp: new Date().toISOString(),
    ...data,
  });
  
  await redisPub.publish(channel, payload);
  logger.debug({ orderId, status, channel }, 'Status published');
};

/**
 * Process a single order job
 */
const processOrder = async (job: Job<IOrderJobPayload>): Promise<void> => {
  const { orderId, request, correlationId } = job.data;
  const orderLogger = createOrderLogger(orderId, job.id);
  
  orderLogger.info({
    attempt: job.attemptsMade + 1,
    maxAttempts: config.MAX_RETRIES,
  }, 'Processing order...');

  try {
    // Step 1: Update status to ROUTING
    await updateOrderStatus(orderId, OrderStatus.ROUTING);
    await publishStatus(orderId, OrderStatus.ROUTING);

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
    await publishStatus(orderId, OrderStatus.ROUTING, {
      dex: selectedDex,
      raydiumQuote: raydium.price,
      meteoraQuote: meteora.price,
      reason,
    });

    // Step 4: Update status to BUILDING
    await updateOrderStatus(orderId, OrderStatus.BUILDING);
    await publishStatus(orderId, OrderStatus.BUILDING, { dex: selectedDex });

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
    await publishStatus(orderId, OrderStatus.SUBMITTED, { txHash: swapResult.txHash });

    // Step 8: Update status to CONFIRMED
    const amountOut = (parseFloat(request.amount) * parseFloat(swapResult.executedPrice)).toFixed(9);
    await updateOrderConfirmed(orderId, swapResult.txHash, swapResult.executedPrice, amountOut);
    await publishStatus(orderId, OrderStatus.CONFIRMED, {
      txHash: swapResult.txHash,
      executedPrice: swapResult.executedPrice,
      amountOut,
    });

    orderLogger.info({
      txHash: swapResult.txHash,
      executedPrice: swapResult.executedPrice,
      dex: selectedDex,
    }, 'Order completed successfully');

  } catch (err) {
    const error = err as Error;
    orderLogger.error({ err: error }, 'Order processing failed');

    // Check if this is the final attempt
    if (job.attemptsMade + 1 >= config.MAX_RETRIES) {
      await updateOrderFailed(orderId, error.message, job.attemptsMade + 1, config.MAX_RETRIES);
      await publishStatus(orderId, OrderStatus.FAILED, {
        failureReason: error.message,
        attempt: job.attemptsMade + 1,
        maxAttempts: config.MAX_RETRIES,
      });
    } else {
      // Will retry - publish retry info
      const nextRetryAt = new Date(Date.now() + Math.pow(2, job.attemptsMade + 1) * 1000);
      await publishStatus(orderId, OrderStatus.PENDING, {
        error: error.message,
        attempt: job.attemptsMade + 1,
        maxAttempts: config.MAX_RETRIES,
        nextRetryAt: nextRetryAt.toISOString(),
      });
    }

    throw err; // Re-throw to trigger BullMQ retry
  }
};

/**
 * Create and start the order worker
 */
export const createOrderWorker = (): Worker<IOrderJobPayload> => {
  const worker = new Worker<IOrderJobPayload>(
    ORDER_QUEUE_NAME,
    processOrder,
    {
      connection: {
        host: new URL(config.REDIS_URL).hostname,
        port: parseInt(new URL(config.REDIS_URL).port || '6379'),
      },
      concurrency: config.QUEUE_CONCURRENCY,
      limiter: {
        max: 100,
        duration: 60000, // 100 orders per minute max
      },
    }
  );

  // Worker event handlers
  worker.on('completed', (job) => {
    logger.info({ orderId: job.data.orderId, jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    if (job) {
      logger.error({ orderId: job.data.orderId, jobId: job.id, err }, 'Job failed');
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });

  logger.info({ concurrency: config.QUEUE_CONCURRENCY }, 'Order worker started');

  return worker;
};

/**
 * Close worker gracefully
 */
export const closeWorker = async (worker: Worker): Promise<void> => {
  await worker.close();
  logger.info('Order worker closed');
};
