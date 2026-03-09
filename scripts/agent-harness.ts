#!/usr/bin/env tsx
import process from 'process';

type HarnessOptions = {
  marketId: string;
  accountId: string;
  agentKey: string;
  adminKey?: string;
  inviteCode: string;
  apiBase: string;
  testPrice: number;
  testQuantity: number;
};

type TrustTier = 'UNVERIFIED' | 'VERIFIED' | 'TRUSTED';

const parseArgs = (): HarnessOptions => {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      opts[key] = value;
      i += 1;
    }
  }

  const marketId = opts.market || opts.marketId || process.env.HARNESS_MARKET_ID;
  const accountId = opts.account || opts.accountId || process.env.HARNESS_ACCOUNT_ID;
  const agentKey = opts.agentKey || process.env.HARNESS_AGENT_KEY;
  const adminKey = opts.adminKey || process.env.HARNESS_ADMIN_KEY;
  const inviteCode =
    opts.invite || process.env.HARNESS_INVITE_CODE || process.env.NEXT_PUBLIC_INVITE_CODE;
  const apiBase = opts.apiBase || process.env.HARNESS_API_BASE || 'https://app.oraclebook.xyz';
  const testPrice = opts.price ? Number(opts.price) : 20;
  const testQuantity = opts.quantity ? Number(opts.quantity) : 1;

  if (!marketId) throw new Error('marketId required (use --market)');
  if (!accountId) throw new Error('accountId required (use --account)');
  if (!agentKey) throw new Error('agentKey required (use --agentKey)');
  if (!inviteCode) throw new Error('invite code required (set HARNESS_INVITE_CODE or --invite)');

  return { marketId, accountId, agentKey, adminKey, inviteCode, apiBase, testPrice, testQuantity };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function patchTrust(
  opts: HarnessOptions,
  tier: TrustTier,
  label: string
): Promise<void> {
  if (!opts.adminKey) {
    console.log(`⚠️  Skipping trust toggle (${label}); no admin key provided.`);
    return;
  }
  const res = await fetch(
    `${opts.apiBase}/api/agents/by-account/${opts.accountId}/trust`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Invite-Code': opts.inviteCode,
        Authorization: `Bearer ${opts.adminKey}`,
      },
      body: JSON.stringify({ trustTier: tier }),
    }
  );
  const body = await res.text();
  console.log(`→ Trust ${label} [${tier}] ${res.status}: ${body}`);
}

async function placeOrder(
  opts: HarnessOptions,
  payload: Record<string, unknown>,
  label: string
) {
  const res = await fetch(`${opts.apiBase}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Invite-Code': opts.inviteCode,
      'X-Agent-Key': opts.agentKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`→ ${label} ${res.status}: ${text}`);
  if (!res.ok) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed?.order?.id ?? null;
  } catch {
    return null;
  }
}

async function cancelOrder(opts: HarnessOptions, orderId: string | null) {
  if (!orderId) return;
  const url = new URL(`${opts.apiBase}/api/orders/${orderId}`);
  url.searchParams.set('accountId', opts.accountId);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'X-Invite-Code': opts.inviteCode,
      'X-Agent-Key': opts.agentKey,
    },
  });
  const txt = await res.text();
  console.log(`→ Cancel ${orderId} ${res.status}: ${txt}`);
}

async function main() {
  const opts = parseArgs();
  console.log('OracleBook agent harness');
  console.log('Config:', {
    marketId: opts.marketId,
    accountId: opts.accountId,
    apiBase: opts.apiBase,
  });

  await patchTrust(opts, 'VERIFIED', 'downgrade to verify guardrail');

  await placeOrder(
    opts,
    {
      marketId: opts.marketId,
      accountId: opts.accountId,
      side: 'BUY',
      type: 'LIMIT',
      price: opts.testPrice,
      quantity: opts.testQuantity,
    },
    'Agent order without reason (expected 400)'
  );

  await patchTrust(opts, 'TRUSTED', 'promote to resume trading');
  await sleep(1100);

  const validOrderId = await placeOrder(
    opts,
    {
      marketId: opts.marketId,
      accountId: opts.accountId,
      side: 'SELL',
      type: 'LIMIT',
      price: opts.testPrice,
      quantity: opts.testQuantity,
      reasonForTrade: {
        reason: 'Harness sanity check',
        theoreticalPriceMethod: 'manual sanity',
        confidenceInterval: [opts.testPrice - 2, opts.testPrice + 2],
      },
    },
    'Valid agent order'
  );

  await sleep(500);
  await cancelOrder(opts, validOrderId);
  await sleep(1100);

  await placeOrder(
    opts,
    {
      marketId: opts.marketId,
      accountId: opts.accountId,
      side: 'SELL',
      type: 'LIMIT',
      price: opts.testPrice,
      quantity: opts.testQuantity,
      reasonForTrade: {
        reason: 'Confidence reversal test',
        theoreticalPriceMethod: 'manual sanity',
        confidenceInterval: [opts.testPrice + 5, opts.testPrice - 5],
      },
    },
    'Malformed confidence interval (expected 400)'
  );

  console.log('Harness complete.');
}

main().catch((err) => {
  console.error('Harness failed', err);
  process.exitCode = 1;
});
