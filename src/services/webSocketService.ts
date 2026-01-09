import { WebSocket } from 'ws';
import { redis, redisSub } from '../config/redis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getOrderById } from '../models/order';
import { ORDER_CHANNEL_PREFIX } from '../lib/queue';
import { IOrder, OrderStatus } from '../types';

const CONNECTION_LIMIT_PREFIX = 'ws:connections:';
const MAX_CONNECTIONS_PER_ORDER_IP = 3;

/**
 * WebSocket Service - Handles WebSocket connection lifecycle
 */
export class WebSocketService {
  private connections: Map<string, Set<WebSocket>> = new Map();
  private heartbeatIntervals: Map<WebSocket, NodeJS.Timeout> = new Map();
  private pongTimeouts: Map<WebSocket, NodeJS.Timeout> = new Map();
  private subscriptions: Map<WebSocket, string> = new Map();

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(
    socket: WebSocket,
    orderId: string,
    clientIp: string
  ): Promise<void> {
    const connectionKey = `${orderId}:${clientIp}`;

    logger.info({ orderId, clientIp }, 'New WebSocket connection');

    try {
      // Check connection limit
      const allowed = await this.checkConnectionLimit(orderId, clientIp);
      if (!allowed) {
        logger.warn({ orderId, clientIp }, 'Connection limit exceeded');
        this.sendError(socket, 'Connection limit exceeded (max 3 per order per IP)');
        socket.close(4029, 'Too many connections');
        return;
      }

      // Register connection
      await this.registerConnection(orderId, clientIp, socket);

      // Send initial backfill
      await this.sendBackfill(socket, orderId);

      // Subscribe to Redis PubSub
      await this.subscribeToUpdates(socket, orderId);

      // Start heartbeat
      this.startHeartbeat(socket);

      // Handle socket events
      socket.on('pong', () => this.handlePong(socket));
      socket.on('close', () => this.handleClose(socket, orderId, clientIp));
      socket.on('error', (err: Error) => logger.error({ err, orderId }, 'WebSocket error'));

    } catch (err) {
      logger.error({ err, orderId }, 'Failed to handle WebSocket connection');
      this.sendError(socket, 'Failed to initialize connection');
      socket.close(1011, 'Server error');
    }
  }

  /**
   * Check if connection is allowed (max 3 per orderId per IP)
   */
  private async checkConnectionLimit(orderId: string, clientIp: string): Promise<boolean> {
    const key = `${CONNECTION_LIMIT_PREFIX}${orderId}:${clientIp}`;
    const count = await redis.get(key);
    return !count || parseInt(count) < MAX_CONNECTIONS_PER_ORDER_IP;
  }

  /**
   * Register a new connection
   */
  private async registerConnection(orderId: string, clientIp: string, socket: WebSocket): Promise<void> {
    const key = `${CONNECTION_LIMIT_PREFIX}${orderId}:${clientIp}`;
    await redis.incr(key);
    await redis.expire(key, 3600); // 1 hour expiry

    const connectionKey = `${orderId}:${clientIp}`;
    if (!this.connections.has(connectionKey)) {
      this.connections.set(connectionKey, new Set());
    }
    this.connections.get(connectionKey)!.add(socket);
  }

  /**
   * Unregister a connection
   */
  private async unregisterConnection(orderId: string, clientIp: string, socket: WebSocket): Promise<void> {
    const key = `${CONNECTION_LIMIT_PREFIX}${orderId}:${clientIp}`;
    await redis.decr(key);

    const connectionKey = `${orderId}:${clientIp}`;
    this.connections.get(connectionKey)?.delete(socket);
    if (this.connections.get(connectionKey)?.size === 0) {
      this.connections.delete(connectionKey);
    }
  }

  /**
   * Send initial backfill (current status + logs)
   */
  private async sendBackfill(socket: WebSocket, orderId: string): Promise<void> {
    const order = await getOrderById(orderId);

    if (!order) {
      this.sendError(socket, 'Order not found');
      socket.close(4004, 'Order not found');
      return;
    }

    const backfillMessage = {
      type: 'backfill',
      orderId,
      status: order.status,
      logs: order.logs,
      order: {
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        amountIn: order.amountIn,
        amountOut: order.amountOut,
        dexUsed: order.dexUsed,
        txHash: order.txHash,
        failureReason: order.failureReason,
      },
      timestamp: new Date().toISOString(),
    };

    this.send(socket, backfillMessage);
    logger.debug({ orderId, status: order.status }, 'Backfill sent');
  }

  /**
   * Subscribe to Redis PubSub for order updates
   */
  private async subscribeToUpdates(socket: WebSocket, orderId: string): Promise<void> {
    const channel = `${ORDER_CHANNEL_PREFIX}${orderId}`;

    // Store subscription info
    this.subscriptions.set(socket, channel);

    // Subscribe to channel
    await redisSub.subscribe(channel);

    // Handle messages
    const messageHandler = (receivedChannel: string, message: string) => {
      if (receivedChannel === channel && socket.readyState === WebSocket.OPEN) {
        try {
          const data = JSON.parse(message);
          this.send(socket, {
            type: 'status_update',
            ...data,
          });
        } catch (err) {
          logger.error({ err, channel }, 'Failed to parse PubSub message');
        }
      }
    };

    redisSub.on('message', messageHandler);

    // Store handler for cleanup
    (socket as unknown as Record<string, unknown>)._messageHandler = messageHandler;
  }

  /**
   * Start heartbeat ping/pong
   */
  private startHeartbeat(socket: WebSocket): void {
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();

        // Set pong timeout
        const pongTimeout = setTimeout(() => {
          logger.warn('Pong timeout, closing connection');
          socket.terminate();
        }, config.PONG_TIMEOUT);

        this.pongTimeouts.set(socket, pongTimeout);
      }
    }, config.PING_INTERVAL);

    this.heartbeatIntervals.set(socket, pingInterval);
  }

  /**
   * Handle pong response
   */
  private handlePong(socket: WebSocket): void {
    const timeout = this.pongTimeouts.get(socket);
    if (timeout) {
      clearTimeout(timeout);
      this.pongTimeouts.delete(socket);
    }
  }

  /**
   * Handle connection close - cleanup
   */
  private async handleClose(socket: WebSocket, orderId: string, clientIp: string): Promise<void> {
    logger.info({ orderId, clientIp }, 'WebSocket connection closed');

    // Clear heartbeat
    const interval = this.heartbeatIntervals.get(socket);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(socket);
    }

    // Clear pong timeout
    const timeout = this.pongTimeouts.get(socket);
    if (timeout) {
      clearTimeout(timeout);
      this.pongTimeouts.delete(socket);
    }

    // Unsubscribe from Redis
    const channel = this.subscriptions.get(socket);
    if (channel) {
      // Remove message handler
      const handler = (socket as unknown as Record<string, unknown>)._messageHandler as 
        ((channel: string, message: string) => void) | undefined;
      if (handler) {
        redisSub.off('message', handler);
      }
      
      // Only unsubscribe if no other connections to this channel
      const otherConnections = Array.from(this.subscriptions.values()).filter(c => c === channel).length;
      if (otherConnections <= 1) {
        await redisSub.unsubscribe(channel);
      }
      
      this.subscriptions.delete(socket);
    }

    // Unregister connection
    await this.unregisterConnection(orderId, clientIp, socket);
  }

  /**
   * Send message to socket
   */
  private send(socket: WebSocket, data: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  /**
   * Send error message
   */
  private sendError(socket: WebSocket, message: string): void {
    this.send(socket, {
      type: 'error',
      message,
      timestamp: new Date().toISOString(),
    });
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();
