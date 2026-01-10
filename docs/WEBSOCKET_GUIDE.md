# WebSocket Streaming Guide

This document explains how to connect to the WebSocket endpoint for real-time order status updates.

## Connection Details

**WebSocket URL Pattern:**

```
wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId={orderId}
```

## Connection Flow

1. **Submit an order** via `POST /api/orders/execute`
2. **Save the returned `orderId`** from the response
3. **Connect to the WebSocket** using the orderId as a query parameter
4. **Receive real-time updates** as the order progresses through the execution pipeline

## Using Postman for WebSocket Testing

### Step 1: Submit an Order

1. Open the Postman collection
2. Run any request from the "Orders" folder (e.g., "Execute Market Order (SOL → USDC)")
3. The `orderId` will be automatically saved to collection variables

### Step 2: Connect to WebSocket

1. Create a new **WebSocket Request** in Postman
2. Enter the URL:
   ```
   wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId={{orderId}}
   ```
3. Click **Connect**

### Step 3: Observe Real-Time Updates

You'll receive messages in the following sequence:

#### 1. Initial Backfill Message

Sent immediately upon connection with current order state:

```json
{
  "type": "backfill",
  "status": "pending",
  "logs": [
    {
      "timestamp": "2026-01-10T07:30:15.123Z",
      "status": "pending",
      "message": "Order created and queued"
    }
  ]
}
```

#### 2. Status Update: Routing

```json
{
  "type": "status_update",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "routing",
  "timestamp": "2026-01-10T07:30:16.456Z"
}
```

#### 3. Status Update: Building

```json
{
  "type": "status_update",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "building",
  "timestamp": "2026-01-10T07:30:17.789Z",
  "raydiumQuote": "145.32",
  "meteoraQuote": "145.48",
  "selectedDex": "meteora"
}
```

#### 4. Status Update: Submitted

```json
{
  "type": "status_update",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "submitted",
  "timestamp": "2026-01-10T07:30:18.123Z"
}
```

#### 5. Status Update: Confirmed (Final)

```json
{
  "type": "status_update",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "confirmed",
  "timestamp": "2026-01-10T07:30:20.456Z",
  "txHash": "mock-tx-a1b2c3d4e5f6",
  "executedPrice": "145.48",
  "amountOut": "218.22",
  "dexUsed": "meteora"
}
```

## Alternative WebSocket Clients

### Using wscat (CLI)

```bash
npm install -g wscat
wscat -c "wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId=YOUR_ORDER_ID"
```

### Using JavaScript (Browser)

```javascript
const orderId = "YOUR_ORDER_ID";
const ws = new WebSocket(
  `wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId=${orderId}`,
);

ws.onopen = () => {
  console.log("Connected to order stream");
};

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log("Order update:", update);

  if (update.status === "confirmed") {
    console.log("Order completed!", update.txHash);
    ws.close();
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("Connection closed");
};
```

### Using Python

```python
import asyncio
import websockets
import json

async def stream_order(order_id):
    uri = f"wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId={order_id}"

    async with websockets.connect(uri) as websocket:
        print(f"Connected to order stream for {order_id}")

        async for message in websocket:
            update = json.loads(message)
            print("Order update:", update)

            if update.get('status') == 'confirmed':
                print("Order completed!")
                break

# Usage
asyncio.run(stream_order('YOUR_ORDER_ID'))
```

## Status Flow Diagram

```
┌─────────┐
│ PENDING │ ← Order received and queued
└────┬────┘
     │
     ▼
┌─────────┐
│ ROUTING │ ← Fetching quotes from Raydium & Meteora
└────┬────┘
     │
     ▼
┌──────────┐
│ BUILDING │ ← Constructing swap transaction
└────┬─────┘
     │
     ▼
┌───────────┐
│ SUBMITTED │ ← Transaction sent to network
└────┬──────┘
     │
     ▼
┌───────────┐
│ CONFIRMED │ ← Transaction successful ✓
└───────────┘

     OR

┌────────┐
│ FAILED │ ← Error occurred at any stage
└────────┘
```

## Error Handling

If an error occurs, you'll receive a status update with details:

```json
{
  "type": "status_update",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "timestamp": "2026-01-10T07:30:19.789Z",
  "failureReason": "Insufficient liquidity in pool",
  "attempt": 3,
  "maxAttempts": 3
}
```

## Best Practices

1. **Always handle connection errors**: Network issues can occur; implement reconnection logic
2. **Store the backfill data**: The initial message contains the full order history
3. **Close connections after completion**: Once you receive "confirmed" or "failed", close the connection
4. **Use orderId validation**: Ensure the orderId in updates matches your expected order

## Troubleshooting

### Connection Refused

- Verify the orderId is valid (you can check via `GET /api/orders/{orderId}`)
- Ensure you're using `wss://` (not `ws://`) for the production deployment

### No Messages Received

- The order may have already completed before you connected
- Check the backfill message for current status
- Verify network connectivity

### Duplicate Messages

- This is normal; the system may republish status to ensure delivery
- Implement idempotent message handling on the client side
