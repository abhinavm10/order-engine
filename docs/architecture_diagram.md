## Order Execution Engine — Architecture & Flows

### 1. Goals and scope

- **Order type**: Market orders only (V1), with **mock DEX execution** (Raydium vs Meteora).
- **Public API**: Single endpoint `POST /api/orders/execute` (HTTP) + `WS /api/orders/execute` (WebSocket upgrade).
- **Performance targets**: 100 orders/minute throughput, 10 concurrent workers, up to 3 retries with exponential backoff.

### 2. Component view

```mermaid
graph TB
    subgraph Client Layer
        Client["Client - Frontend/Postman"]
    end

    subgraph API Layer
        API["Fastify API - HTTP + WebSocket"]
    end

    subgraph Queue and PubSub
        Q[("Redis Queue - BullMQ")]
        PS[("Redis PubSub")]
        IDEMP[("Redis Keyspace - Idempotency")]
    end

    subgraph Worker Layer
        W[Worker Processes]
    end

    subgraph Data Layer
        DB[("PostgreSQL - Orders")]
    end

    subgraph DEX Simulation
        DEX["MockDexRouter - Raydium + Meteora"]
    end

    Client -->|HTTP POST| API
    Client <-->|WebSocket| API

    API --> Q
    API --> PS
    API --> IDEMP
    API --> DB

    Q --> W
    W --> PS
    W --> DB
    W --> DEX
```

### 3. Request + status flow (sequence)

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Fastify
    participant IDE as IdempCache
    participant DB as Postgres
    participant Q as BullMQ
    participant W as Worker
    participant PS as PubSub

    C->>API: POST /api/orders/execute
    API->>API: Validate body
    API->>IDE: Check Idempotency-Key
    alt duplicate
        IDE-->>API: existing orderId
        API-->>C: success, orderId
    else new
        API->>DB: insert order pending
        API->>IDE: store key TTL 5m
        API->>Q: enqueue job
        API-->>C: success, orderId
    end

    C->>API: WS connect orderId
    API->>DB: fetch status and logs
    API-->>C: backfill status, logs
    API->>PS: subscribe order channel
    loop heartbeat
        API-->>C: ping
        C-->>API: pong
    end

    Q->>W: dequeue job
    W->>PS: publish routing
    API-->>C: routing
    W->>W: fetch quotes
    W->>PS: publish building
    API-->>C: building
    W->>W: executeSwap
    W->>DB: update confirmed
    W->>PS: publish confirmed
    API-->>C: confirmed
    Note over W: on error retry with backoff
```

### 4. Data model (orders essentials)

- **Identity & status**
  - `id` (UUID, primary key)
  - `status` enum: `pending` | `routing` | `building` | `submitted` | `confirmed` | `failed`
- **Trade parameters**
  - `type` (e.g. `market`)
  - `token_in`, `token_out`
  - `amount_in` (DECIMAL; exposed as **string** in JSON)
  - `slippage`
- **Execution result**
  - `amount_out`
  - `dex_used`
  - `tx_hash`
  - `failure_reason`
- **Routing transparency**
  - `raydium_quote`, `meteora_quote`
  - `logs` JSONB array (bounded length; truncate/rollover if more than _N_ entries)
- **Timestamps**
  - `created_at`, `updated_at`

### 5. Idempotency & rate limiting

- **Idempotency header**: `Idempotency-Key` (opaque string).
  - Stored in Redis with TTL **5 minutes**; value is `orderId`.
  - Same key + same body → return existing `orderId` (no new job).
  - Same key + different body → **409** `idempotency_conflict`.
- **Rate limiting**:
  - Token bucket, e.g. **30 requests/minute per IP**.
  - Exceeding limit → **429** with `retryAfter` hint.

### 6. Backpressure & resilience

- **Queue / Redis issues**
  - If Redis queue unreachable or queue length exceeds threshold → **503** `service_unavailable` or **429** `queue_full` (as per condition).
- **Job timeouts**
  - BullMQ per-job timeout and total job deadline (e.g. 30s); on exceed → mark order `failed` with `failureReason="timeout"`.
- **Graceful shutdown**
  - Worker waits for active jobs to finish, then closes Redis and DB connections cleanly.

### 7. WebSocket contract

- **Connect**: `WS /api/orders/execute?orderId=<uuid>`
- **Initial backfill** (first message):
  - `{ orderId, status, logs }`
- **Heartbeat**:
  - Server sends `ping` every **20s**; client must reply `pong` within **10s**.
  - Missing 2 consecutive heartbeats → server disconnects.
- **Reconnect behavior**:
  - Client can reconnect with same `orderId`; server re-sends latest snapshot and resumes live events.
- **Subscription limits**:
  - At most **3 concurrent WebSocket connections** per `orderId` per IP; extra connections receive **429** and are closed.
- **Event types** (status updates):
  - `routing`
  - `building` (includes chosen DEX + quotes)
  - `submitted`
  - `confirmed` (includes `txHash`, `executedPrice`)
  - `failed` (includes `failureReason`, `error` code)
  - Retry metadata (when applicable): `attempt`, `maxAttempts`, `nextRetryAt`

### 8. Mock DEX behavior

- **Quotes**
  - Raydium variance: **-2.5% to +2.5%** around a base price.
  - Meteora variance: **-3% to +3%** around a base price.
- **Determinism**
  - Optional `MOCK_SEED` enables deterministic random sequence for tests.
  - Default mode uses non-deterministic randomness in dev.
- **Execution**
  - Simulated delay **2–3 seconds**.
  - Returns mock `txHash` and `executedPrice`.
  - Worker performs **slippage checks** before marking `confirmed`.

### 9. Observability

- **Structured logging**
  - Include: `orderId`, `jobId`, `status`, `attempt`, `duration_ms`, `dex`, and error codes.
- **Metrics**
  - Counters: orders by final status, retry count, failure count.
  - Histograms: quote latency, execution latency, queue wait time.
  - Gauges: queue depth, active workers, WS connection count.
- **Correlation**
  - Correlation ID generated per request and propagated to worker and WS logs where applicable.

### 10. Security & cross-cutting concerns

- **CORS**
  - Restrictive list of allowed origins; no wildcard in production.
- **Validation & sanitization**
  - All inputs validated via Zod/Joi; string fields sanitized before logging.
- **Auth**
  - V1 is an **unauthenticated demo**; code keeps hooks for future auth (e.g. JWT/middleware).
- **Logging hygiene**
  - No PII in logs; cap log sizes and truncate `logs` JSON arrays if needed.

### 11. Failure semantics (summary)

- **HTTP**:
  - `400` `invalid_body`
  - `401` / `403` (reserved for future auth)
  - `404` `not_found`
  - `409` `idempotency_conflict`
  - `429` `rate_limited` / `queue_full`
  - `503` `service_unavailable`
- **WebSocket**:
  - Terminal failure message: `{ status: "failed", failureReason, error }` then connection is closed.
- **Retries**:
  - Up to **3 attempts** with exponential backoff: **2s, 4s, 8s**.
  - Retry metadata is included in WS updates so clients can visualize progress.

---

### 12. Directory structure

```
eterna_backend/
├── docker-compose.yml          # Redis + PostgreSQL + App
├── Dockerfile                  # Node.js container
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── postman_collection.json     # API collection for testing
│
├── src/
│   ├── app.ts                  # Fastify server entry point
│   ├── worker.ts               # BullMQ worker entry point
│   │
│   ├── config/
│   │   ├── index.ts            # Environment variables
│   │   ├── redis.ts            # Redis connection
│   │   └── database.ts         # PostgreSQL connection
│   │
│   ├── routes/
│   │   ├── orders.ts           # /api/orders/execute (POST + WS)
│   │   └── health.ts           # /health
│   │
│   ├── controllers/
│   │   └── orderController.ts  # Request handlers
│   │
│   ├── services/
│   │   ├── orderService.ts     # Business logic
│   │   └── websocketService.ts # WebSocket management
│   │
│   ├── lib/
│   │   ├── queue/
│   │   │   ├── producer.ts     # Add jobs to queue
│   │   │   └── consumer.ts     # Process jobs
│   │   │
│   │   └── dex/
│   │       ├── mockDexRouter.ts    # Main router
│   │       ├── raydiumSimulator.ts # Raydium mock
│   │       └── meteoraSimulator.ts # Meteora mock
│   │
│   ├── models/
│   │   └── order.ts            # Order DB operations
│   │
│   ├── types/
│   │   └── index.ts            # TypeScript interfaces
│   │
│   └── utils/
│       ├── logger.ts           # Logging utility
│       └── helpers.ts          # Common helpers
│
└── tests/
    ├── unit/
    │   ├── dexRouter.test.ts
    │   ├── orderService.test.ts
    │   └── queue.test.ts
    │
    └── integration/
        ├── orderFlow.test.ts
        └── websocket.test.ts
```

---

### 13. Docker Compose (local dev)

```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  worker:
    build: .
    command: npm run worker
    environment:
      - NODE_ENV=development
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: order_engine
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d order_engine"]
      interval: 5s
      timeout: 3s
      retries: 3

volumes:
  pgdata:
```

---

### 14. Configuration defaults

| Variable            | Default                                              | Description                              |
| :------------------ | :--------------------------------------------------- | :--------------------------------------- |
| `PORT`              | 3000                                                 | API server port                          |
| `REDIS_URL`         | redis://localhost:6379                               | Redis connection                         |
| `DATABASE_URL`      | postgres://user:password@localhost:5432/order_engine | PostgreSQL                               |
| `QUEUE_CONCURRENCY` | 10                                                   | Max concurrent jobs per worker           |
| `MAX_RETRIES`       | 3                                                    | Max retry attempts                       |
| `LOG_LEVEL`         | info                                                 | Logging verbosity                        |
| `MOCK_SEED`         | _(empty)_                                            | Optional seed for deterministic mock DEX |
| `RATE_LIMIT`        | 30                                                   | Requests per minute per IP               |
| `PING_INTERVAL`     | 20000                                                | WebSocket ping interval (ms)             |
| `PONG_TIMEOUT`      | 10000                                                | WebSocket pong timeout (ms)              |
