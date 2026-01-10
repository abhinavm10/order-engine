# Order Execution Engine - Postman Collection

This Postman collection provides comprehensive testing capabilities for the Order Execution Engine API deployed at `https://order-engine-production-4040.up.railway.app`.

## 📦 What's Included

### 1. **Orders** Folder

- **Execute Market Order (SOL → USDC)**: Standard market order with auto-saved orderId
- **Execute Market Order (USDC → SOL)**: Reverse swap example
- **Execute Large Order**: Tests routing with larger amounts (50 SOL)
- **Test Idempotency**: Demonstrates duplicate request prevention
- **Get Order Status**: Retrieves order details by ID

### 2. **Health & Monitoring** Folder

- **Health Check**: Basic API health verification
- **Queue Metrics**: Real-time queue statistics (waiting, active, completed, failed)
- **System Metrics**: Comprehensive performance metrics

### 3. **Validation Tests** Folder

- **Invalid Order Type**: Tests error handling for invalid inputs
- **Negative Amount**: Tests validation of negative values
- **Excessive Slippage**: Tests slippage bounds (max 10%)
- **Same Token Pair**: Tests prevention of invalid swaps

## 🚀 Getting Started

### Step 1: Import Collection

1. Download `postman_collection.json`
2. Open Postman
3. Click **Import** (top left)
4. Select the downloaded file
5. Collection will appear in your sidebar

### Step 2: Run Your First Order

1. Open the collection
2. Navigate to **Orders** → **Execute Market Order (SOL → USDC)**
3. Click **Send**
4. The response will contain an `orderId` (automatically saved to collection variables)

**Example Response:**

```json
{
  "success": true,
  "orderId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Step 3: Stream Real-Time Updates via WebSocket

1. In Postman, create a **New WebSocket Request**
2. Enter URL:
   ```
   wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId={{orderId}}
   ```
3. Click **Connect**
4. Watch the status updates flow in real-time!

**You'll see messages like:**

```json
{
  "type": "status_update",
  "status": "routing",
  "timestamp": "2026-01-10T07:30:16.456Z"
}
```

→ See [docs/WEBSOCKET_GUIDE.md](./docs/WEBSOCKET_GUIDE.md) for complete WebSocket documentation

## 🔄 Collection Variables

The collection uses these variables (auto-managed):

| Variable  | Description           | Example                                               |
| --------- | --------------------- | ----------------------------------------------------- |
| `baseUrl` | API base URL          | `https://order-engine-production-4040.up.railway.app` |
| `wsUrl`   | WebSocket URL         | `wss://order-engine-production-4040.up.railway.app`   |
| `orderId` | Last created order ID | `550e8400-e29b-...`                                   |

## 📝 Pre-Request Scripts

Each order request includes a script that:

- Generates a unique `Idempotency-Key` using `{{$guid}}`
- Logs the request URL for debugging

## ✅ Tests Included

Each request has automated tests:

**Example from "Execute Market Order":**

```javascript
pm.test("Status code is 200", () => {
  pm.response.to.have.status(200);
});

pm.test("Response contains orderId", () => {
  pm.expect(response).to.have.property("orderId");
  pm.expect(response.orderId).to.be.a("string");
});
```

Run all tests:

1. Right-click collection → **Run collection**
2. Click **Run Order Execution Engine API**
3. View test results in the runner

## 🧪 Testing Scenarios

### Test Concurrent Orders

1. Open **Execute Market Order (SOL → USDC)**
2. Click **Send** 5 times rapidly
3. Open **Queue Metrics** and verify queue depth
4. Each order gets processed with proper concurrency control

### Test Idempotency

1. Run **Test Idempotency (Duplicate Request)** twice
2. First request creates a new order
3. Second request returns the existing order (same orderId)

### Test Validation

1. Run all requests in **Validation Tests** folder
2. Each should return `400 Bad Request` with descriptive error messages

### Monitor Performance

1. Run **System Metrics** after processing several orders
2. View success rates, average latency, and queue depth

## 🌐 WebSocket Testing Examples

### Complete Order Flow

**1. Submit Order:**

```
POST /api/orders/execute
```

**2. Connect WebSocket:**

```
wss://order-engine-production-4040.up.railway.app/api/orders/execute?orderId=YOUR_ID
```

**3. Receive Updates:**

- `pending` → Order queued
- `routing` → Comparing DEX prices
- `building` → Constructing transaction
- `submitted` → Sent to network
- `confirmed` → ✅ Success!

See full message formats in [WEBSOCKET_GUIDE.md](./docs/WEBSOCKET_GUIDE.md)

## 🛠️ Troubleshooting

### "Could not get any response"

- Check if the Railway deployment is running
- Verify the baseUrl is correct
- Railway may take 30-60s to wake from sleep on first request

### WebSocket won't connect

- Ensure you're using `wss://` (not `ws://`)
- Verify the orderId exists (use GET /api/orders/{orderId})
- Check your network allows WebSocket connections

### Validation errors

- Review the request body schema
- Check that slippage is between 0.001 and 0.1 (0.1% to 10%)
- Ensure tokenIn and tokenOut are different

## 📚 Additional Resources

- **[Backend Task Requirements](./docs/Backend%20Task%202_%20Order%20Execution%20Engine.md)** - Original task specification
- **[WebSocket Guide](./docs/WEBSOCKET_GUIDE.md)** - Detailed WebSocket documentation
- **[Main README](./README.md)** - Architecture and setup instructions

## 🎯 Quick Reference

### Supported Token Pairs

- SOL ↔ USDC
- Any valid Solana token symbols (mocked in current implementation)

### Order Lifecycle

```
PENDING → ROUTING → BUILDING → SUBMITTED → CONFIRMED
                                         ↓
                                      FAILED
```

### Rate Limits

- 100 orders/minute (per deployment)
- 10 concurrent executions max
- 3 retry attempts with exponential backoff

---

**Happy Testing! 🚀**

For questions or issues, check the [main README](./README.md) or review the [API documentation](./docs/WEBSOCKET_GUIDE.md).
