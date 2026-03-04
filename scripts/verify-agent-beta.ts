#!/usr/bin/env tsx
/**
 * Smoke test for Agent Beta. Requires server running.
 *
 * Run: FUTURO_ADMIN_KEY=secret tsx scripts/verify-agent-beta.ts
 * Or:  ORACLEBOOK_URL=https://app.oraclebook.xyz FUTURO_ADMIN_KEY=secret tsx scripts/verify-agent-beta.ts
 */
const BASE = process.env.ORACLEBOOK_URL || process.env.FUTURO_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY;

async function req(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, opts);
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => res.text()) };
}

async function main() {
  if (!ADMIN_KEY) {
    console.error('Set FUTURO_ADMIN_KEY');
    process.exit(1);
  }

  console.log('1. Creating agent...');
  const createRes = await req('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
    body: JSON.stringify({ name: 'verify-agent-beta' }),
  });

  if (!createRes.ok) {
    console.error('Create agent failed:', createRes.status, createRes.body);
    process.exit(1);
  }

  const { apiKey, accountId } = createRes.body as { apiKey: string; accountId: string };
  console.log('   OK. accountId=', accountId);

  console.log('2. Fetching account with X-Agent-Key...');
  const accRes = await req(`/api/accounts/${accountId}`, {
    headers: { 'X-Agent-Key': apiKey },
  });
  if (!accRes.ok) {
    console.error('Get account failed:', accRes.status, accRes.body);
    process.exit(1);
  }
  console.log('   OK. balance=', (accRes.body as { balance: number }).balance);

  console.log('3. Placing order (if open market exists)...');
  const marketsRes = await req('/api/markets');
  const markets = Array.isArray(marketsRes.body)
    ? (marketsRes.body as { id: string; state: string; marketType: string }[]).filter((m) => m.state === 'OPEN')
    : [];
  if (markets.length === 0) {
    console.log('   No open markets (run seed:bom-weekly and open a market). Skipped.');
  } else {
    const m = markets[0];
    const side = m.marketType === 'FUTURES' ? 'BUY' : 'BUY_YES';
    const price = m.marketType === 'FUTURES' ? 25 : 0.5;
    const orderRes = await req('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey },
      body: JSON.stringify({ marketId: m.id, side, type: 'LIMIT', price, quantity: 2 }),
    });
    if (orderRes.ok) {
      console.log('   OK. Order placed.');
    } else {
      console.log('   Failed:', orderRes.status, orderRes.body);
    }
  }

  console.log('Agent Beta smoke test passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
