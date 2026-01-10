import axios from 'axios';
import WebSocket from 'ws';

const API_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

const log = (msg: string) => console.log(msg);

async function runWsTest() {
  log('🚀 Starting WebSocket Flow Test...');

  try {
    // Submit order
    const res = await axios.post(`${API_URL}/api/orders/execute`, {
      type: 'market',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: '1.0',
      slippage: '0.05',
    });

    const orderId = res.data.orderId;
    log(`1. Order Submitted: ${orderId}`);

    // Connect WS
    const ws = new WebSocket(`${WS_URL}/api/orders/execute?orderId=${orderId}`);

    ws.on('open', () => log('2. WS Connected'));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'backfill') {
        log(`3. Backfill Received: Status=${msg.status}`);
      } else if (msg.type === 'status_update') {
        log(`4. Live Update: ${msg.status}`);
        
        if (msg.status === 'confirmed') {
          log('✅ SUCCESS: Order Confirmed via WebSocket!');
          log(`   TX: ${msg.txHash}`);
          log(`   Price: ${msg.executedPrice}`);
          ws.close();
          process.exit(0);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('WS Error:', err);
      process.exit(1);
    });

  } catch (err: any) {
    if (err.response?.status === 429) {
      log('❌ Rate Limited. Please wait 60s and try again.');
    } else {
      console.error('Test Failed:', err.message);
    }
    process.exit(1);
  }
}

runWsTest();
