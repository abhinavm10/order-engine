# Order Execution Engine

A high-performance, asynchronous order execution engine designed for the Solana blockchain. This system routes orders to the optimal Decentralized Exchange (DEX) by comparing real-time quotes from Raydium and Meteora, handling high concurrency through a reliable queue system, and providing real-time status updates via WebSockets.

## Table of Contents

1. [Architectural Overview](#architectural-overview)
2. [Design Decisions](#design-decisions)
3. [Order Type Selection](#order-type-selection)
4. [Request Lifecycle](#request-lifecycle)
5. [Prerequisites](#prerequisites)
6. [Installation and Setup](#installation-and-setup)
7. [API Reference](#api-reference)
8. [Testing Strategy](#testing-strategy)
9. [Project Structure](#project-structure)

---

## Architectural Overview

The system utilizes a **Hybrid HTTP/WebSocket architecture** decoupled by an asynchronous worker pattern. This ensures that the public API remains responsive under heavy load while complex routing and blockchain execution logic is handled in the background.

### System Diagram

```mermaid
graph TB
    subgraph Client Layer
        Client["Client Application"]
    end

    subgraph API Layer
        API["Fastify API Server"]
        WS["WebSocket Service"]
        Validation["Zod Validation"]
    end

    subgraph Infrastructure
        RedisQ[("Redis Queue (BullMQ)")]
        RedisPubSub[("Redis PubSub")]
        Postgres[("PostgreSQL Database")]
    end

    subgraph Worker Layer
        Worker["Worker Process"]
        Router["DEX Router"]
        Sim["DEX Simulators"]
    end

    %% Flows
    Client -->|POST /execute| API
    Client <-->|WebSocket Connection| WS
    
    API -->|Validate & Persist| Postgres
    API -->|Enqueue Job| RedisQ
    
    RedisQ -->|Dequeue| Worker
    Worker -->|Fetch Quotes| Router
    Router -->|Raydium/Meteora| Sim
    
    Worker -->|Update Status| Postgres
    Worker -->|Publish Event| RedisPubSub
    RedisPubSub -->|Stream Update| WS
    WS -->|Push to Client| Client
```

### Key Components

*   **API Service**: A lightweight Fastify server that accepts orders, performs validation, checks for idempotency, and manages WebSocket connections.
*   **Worker Service**: A dedicated background process that consumes jobs from the queue. It is responsible for the CPU-intensive tasks of routing, price comparison, and transaction simulation.
*   **Redis**: Acts as the backbone for both the job queue (BullMQ) and the real-time event bus (PubSub).
*   **PostgreSQL**: Provides persistent storage for order history and audit logs.

---

## Design Decisions

### 1. Fastify over Express
We selected Fastify for its low overhead and built-in support for asynchronous request handling. Its plugin architecture allowed for clean integration of WebSocket support (`@fastify/websocket`) and shared schema validation.

### 2. BullMQ for Job Management
Blockchain transactions are inherently asynchronous and prone to network latency. Using an in-memory approach would risk data loss during server restarts. BullMQ provides:
*   **Persistence**: Jobs are stored in Redis, surviving process crashes.
*   **Concurrency Control**: We strictly limit concurrent executions to 10 to prevent rate-limiting from RPC nodes.
*   **Exponential Backoff**: Automatic retries (2s, 4s, 8s) for transient network failures.

### 3. Redis PubSub for Real-Time Updates
Polling the database for order status is inefficient. We implemented a PubSub pattern where the Worker publishes events to a specific channel (`order:status:{id}`). The API subscribes to this channel only when a client connects via WebSocket, ensuring efficient resource usage.

### 4. Idempotency Keys
To prevent double-spending or duplicate orders caused by network retries, every order request is hashed. If a request with the same `Idempotency-Key` and payload hash is received within 5 minutes, the system returns the existing order status instead of creating a new one.

---

## Order Type Selection

**Selected Type: Market Order**

For this V1 implementation, we prioritized **Market Orders**.

**Justification:**
Market orders represent the fundamental atomic unit of a trading engine—immediate execution at the best available price. Implementing this first allows us to focus on the critical challenges of **routing latency** and **execution reliability** without the added complexity of state management required for Limit orders (watching price feeds over time).

**Extensibility:**
The architecture allows for seamless addition of other types:
*   **Limit Orders**: Would involve a new "Price Watcher" service that polls price feeds and only enqueues the job into BullMQ when the target price is triggered.
*   **Sniper Orders**: Would involve listening to mempool or block events to trigger execution in the same block as a liquidity provision event.

---

## Request Lifecycle

1.  **Submission**: The client sends a `POST` request with the token pair and amount.
2.  **Validation**: The API validates the payload and checks the idempotency cache.
3.  **Queuing**: The order is created in PostgreSQL with a `PENDING` status and added to the Redis queue.
4.  **Connection**: The client connects to the WebSocket endpoint to listen for updates.
5.  **Routing**: The Worker picks up the job, queries the Mock DEX Router for quotes from Raydium and Meteora, and selects the best provider based on net output (after fees).
6.  **Execution**: The Worker simulates the transaction, waits for confirmation, and updates the database.
7.  **Notification**: Every state change (`ROUTING` -> `BUILDING` -> `CONFIRMED`) is published to Redis and streamed instantly to the client.

---

## Prerequisites

*   **Node.js**: v18 LTS or higher
*   **Docker & Docker Compose**: Required for running the local infrastructure stack.

---

## Installation and Setup

### 1. Repository Setup

```bash
git clone https://github.com/yourusername/eterna_backend.git
cd eterna_backend
```

### 2. Environment Configuration

Copy the example environment file. The defaults are pre-configured for the Docker environment.

```bash
cp .env.example .env
```

### 3. Start Infrastructure

Start the Redis and PostgreSQL containers:

```bash
docker-compose up -d redis postgres
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Run Application

For development, run the API and Worker in separate terminal windows:

```bash
# Terminal 1: API Server
npm run dev

# Terminal 2: Worker Process
npm run dev:worker
```

Alternatively, run the entire stack using Docker:

```bash
docker-compose up --build
```

---

## API Reference

### Execute Order

**Endpoint**: `POST /api/orders/execute`

Submits a new order for execution.

**Headers**:
*   `Content-Type`: `application/json`
*   `Idempotency-Key` (Optional): Unique string (UUID recommended)

**Request Body**:

```json
{
  "type": "market",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": "1.5",
  "slippage": "0.01"
}
```

**Response**:

```json
{
  "success": true,
  "orderId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### WebSocket Stream

**URL**: `ws://localhost:3000/api/orders/execute?orderId={orderId}`

Connect to this endpoint to receive real-time updates for a specific order.

**Message Format (Backfill)**:
Sent immediately upon connection, containing the current status and log history.

```json
{
  "type": "backfill",
  "status": "pending",
  "logs": [...]
}
```

**Message Format (Status Update)**:
Streamed whenever the order status changes.

```json
{
  "type": "status_update",
  "status": "confirmed",
  "txHash": "mock-tx-hash-123",
  "executedPrice": "145.20",
  "dex": "raydium"
}
```

---

## Testing Strategy

The project utilizes **Vitest** for a fast and unified testing experience.

*   **Unit Tests**: Located in `tests/unit/`. These mock all external dependencies (DB, Redis) to verify business logic, routing calculations, and slippage protection.
*   **Integration Tests**: Located in `tests/integration/`. These spin up the API instance and verify the HTTP endpoints and validation logic.

**Run all tests**:

```bash
npm test
```

---

## Project Structure

```text
src/
├── app.ts                  # API Application Entry Point
├── worker.ts               # Worker Process Entry Point
├── config/                 # Configuration and Env Validation
├── controllers/            # HTTP Request Handlers
├── services/               # Core Business Logic (Order, WebSocket, Metrics)
├── routes/                 # Route Definitions
├── lib/
│   ├── dex/                # Mock DEX Router and Simulators
│   └── queue/              # BullMQ Producer and Consumer Setup
├── models/                 # Database Access Layer (Repositories)
└── middleware/             # Idempotency, Rate Limiting, Backpressure
```
