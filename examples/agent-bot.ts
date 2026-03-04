/**
 * Minimal agent trading bot skeleton.
 * Demonstrates: fetch markets, place order with X-Agent-Key.
 *
 * Run: AGENT_KEY=agent_xxx tsx examples/agent-bot.ts
 */
const BASE_URL = process.env.FUTURO_URL || 'http://localhost:3000';
const AGENT_KEY = process.env.AGENT_KEY;

if (!AGENT_KEY) {
  console.error('Set AGENT_KEY env var (e.g. agent_xxx from POST /api/agents)');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'X-Agent-Key': AGENT_KEY,
};

async function main() {
  // 1. Fetch markets
  const marketsRes = await fetch(`${BASE_URL}/api/markets`);
  const markets = await marketsRes.json();
  const openMarkets = markets.filter((m: { state: string }) => m.state === 'OPEN');

  if (openMarkets.length === 0) {
    console.log('No open markets. Create and open a market first.');
    return;
  }

  const market = openMarkets[0];
  console.log(`Using market: ${market.id} (${market.description})`);

  // 2. Fetch order book
  const ordersRes = await fetch(`${BASE_URL}/api/markets/${market.id}/orders`);
  const orders = await ordersRes.json();
  console.log(`Order book has ${orders.length} orders`);

  // 3. Place a limit order (no accountId - uses agent's account from X-Agent-Key)
  const orderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      marketId: market.id,
      side: 'BUY_YES',
      type: 'LIMIT',
      price: 0.5,
      quantity: 5,
    }),
  });

  if (!orderRes.ok) {
    const err = await orderRes.text();
    console.error('Order failed:', orderRes.status, err);
    return;
  }

  const result = await orderRes.json();
  console.log('Order placed:', result);
}

main().catch(console.error);
