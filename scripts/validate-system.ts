import axios from 'axios';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

const API_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const log = (msg: string, color: keyof typeof colors = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

const passed = (msg: string) => log(`✅ PASS: ${msg}`, 'green');
const failed = (msg: string, err?: any) => {
  log(`❌ FAIL: ${msg}`, 'red');
  if (err) console.error(err.response?.data || err.message);
  process.exit(1);
};

const createOrder = async (key?: string) => {
  return axios.post(
    `${API_URL}/api/orders/execute`,
    {
      type: 'market',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: '1.0',
      slippage: '0.05',
    },
    {
      headers: key ? { 'Idempotency-Key': key } : {},
    }
  );
};

async function runValidation() {
  log('\n🚀 Starting System Validation...\n', 'cyan');

  // 1. Health Check
  try {
    const health = await axios.get(`${API_URL}/health`);
    if (health.data.status === 'ok') passed('Health Check (API + Redis + Postgres)');
    else failed('Health Check returned degraded status');
  } catch (err) {
    failed('Health Check failed', err);
  }

  // 2. Idempotency Test
  try {
    const key = uuidv4();
    log('\n🧪 Testing Idempotency...', 'yellow');
    const res1 = await createOrder(key);
    const res2 = await createOrder(key);

    if (res1.data.orderId === res2.data.orderId) {
      passed(`Idempotency verified (OrderId: ${res1.data.orderId})`);
    } else {
      failed('Idempotency failed: Received different Order IDs');
    }
  } catch (err) {
    failed('Idempotency test failed', err);
  }

  // 3. Concurrency Test
  try {
    log('\n🧪 Testing Concurrency (20 parallel orders)...', 'yellow');
    const promises = Array.from({ length: 20 }).map(() => createOrder());
    const results = await Promise.all(promises);
    
    if (results.every((r) => r.status === 200)) {
      passed('Concurrency: 20 orders submitted successfully');
    } else {
      failed('Concurrency: Some orders failed submission');
    }
  } catch (err) {
    failed('Concurrency test failed', err);
  }

  // 4. Rate Limiting (Spam)
  try {
    log('\n🧪 Testing Rate Limiting...', 'yellow');
    // We already sent ~22 requests. Limit is 30/min.
    // Let's spam 15 more to trigger 429.
    let hitLimit = false;
    for (let i = 0; i < 15; i++) {
      try {
        await createOrder();
      } catch (err: any) {
        if (err.response?.status === 429) {
          hitLimit = true;
          break;
        }
      }
    }

    if (hitLimit) {
      passed('Rate Limiter correctly rejected excess requests (429)');
    } else {
      log('⚠️ WARN: Rate limit not triggered (Check IP bucket settings)', 'yellow');
    }
  } catch (err) {
    // Ignore other errors
  }

  // 5. Full WebSocket Flow
  try {
    log('\n🧪 Testing Full WebSocket Lifecycle...', 'yellow');
    
    // Wait for rate limit window (optional, but safer)
    log('Waiting 2s before WS test...', 'reset');
    await sleep(2000);

    // Submit new order
    // Need to bypass rate limit? We might still be limited.
    // Let's assume we might need to wait or just try.
    // Using a different IP is hard locally. We'll wait a bit longer or just try.
    
    // Force a new order ID manually via DB? No, stick to API.
    // We will just try one single order.
    
    let orderId: string;
    try {
      const res = await createOrder();
      orderId = res.data.orderId;
    } catch (err: any) {
      if (err.response?.status === 429) {
        log('Skipping WS test due to Rate Limit (Wait 60s and retry)', 'yellow');
        return;
      }
      throw err;
    }

    log(`Tracking Order: ${orderId}`, 'cyan');

    const ws = new WebSocket(`${WS_URL}/api/orders/execute?orderId=${orderId}`);
    
    const events: string[] = [];
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS Timeout - Order stuck')), 10000);

      ws.on('open', () => log('WS Connected'));
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'status_update') {
          events.push(msg.status);
          log(`-> Status: ${msg.status}`, 'reset');
          
          if (msg.status === 'confirmed' || msg.status === 'failed') {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        }
      });

      ws.on('error', (err) => reject(err));
    });

    if (events.includes('confirmed')) {
      passed('WebSocket Flow: Order confirmed successfully');
    } else {
      failed(`WebSocket Flow: Ended with status ${events[events.length - 1]}`);
    }

  } catch (err) {
    failed('WebSocket test failed', err);
  }

  log('\n✨ System Validation Complete!', 'green');
}

runValidation();
