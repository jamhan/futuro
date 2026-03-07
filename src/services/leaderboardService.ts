import Decimal from 'decimal.js';
import { getPrismaClient } from '../db/client';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';

const prisma = getPrismaClient();

const UNVERIFIED_ORDER_INTERVAL_SEC = parseInt(
  process.env.AGENT_UNVERIFIED_ORDER_INTERVAL_SEC ?? '300',
  10
);

export interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  accountId: string;
  pnl: number;
  balance: number;
  startingBalance: number;
  brierScore?: number;
  logLoss?: number;
}

const DEFAULT_LEADERBOARD_LIMIT = 100;
const MAX_LEADERBOARD_LIMIT = 500;

/**
 * Compute PnL as (current balance - starting balance) for each agent.
 * Uses DB-level ORDER BY and LIMIT to avoid loading all agents into memory.
 * @param limit - Max entries to return (default 100, max 500).
 */
export async function getLeaderboard(limit = DEFAULT_LEADERBOARD_LIMIT): Promise<LeaderboardEntry[]> {
  const take = Math.min(Math.max(1, limit), MAX_LEADERBOARD_LIMIT);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      accountId: string;
      balance: unknown;
      startingBalance: unknown;
      pnl: unknown;
    }>
  >`
    SELECT ap.id, ap.name, ap."accountId",
           a.balance::float,
           ap."startingBalance"::float,
           (a.balance::float - ap."startingBalance"::float) as pnl
    FROM agent_profiles ap
    JOIN accounts a ON a.id = ap."accountId"
    WHERE ap.status = 'ACTIVE'
    ORDER BY pnl DESC
    LIMIT ${take}
  `;

  return rows.map((r) => ({
    agentId: r.id,
    agentName: r.name,
    accountId: r.accountId,
    pnl: Number(r.pnl),
    balance: Number(r.balance),
    startingBalance: Number(r.startingBalance),
  }));
}

export async function getAgentTelemetry(agentId: string): Promise<{
  agentId: string;
  name: string;
  accountId: string;
  balance: number;
  startingBalance: number;
  pnl: number;
  valuationCount?: number;
} | null> {
  const profile = await prisma.agentProfile.findUnique({
    where: { id: agentId },
    include: { account: true },
  });
  if (!profile) return null;

  const balance = Number(profile.account.balance.toString());
  const starting = Number(profile.startingBalance.toString());
  const valuationCount = await prisma.valuationSubmission.count({
    where: { agentId },
  });

  return {
    agentId: profile.id,
    name: profile.name,
    accountId: profile.accountId,
    balance,
    startingBalance: starting,
    pnl: balance - starting,
    valuationCount,
  };
}

/**
 * Human-readable deployment cap from trust tier (matches agentPerMarketRateLimit).
 */
export function getDeploymentCapDescription(trustTier: string): string {
  if (trustTier === 'UNVERIFIED') {
    return `1 order per ${UNVERIFIED_ORDER_INTERVAL_SEC}s (unverified agent)`;
  }
  return '1 order/sec per market';
}

/**
 * Sum trade cashflow (seller credits minus buyer debits) for trades in last 24h.
 */
export async function getAgentPnl24h(accountId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const trades = await prisma.trade.findMany({
    where: {
      OR: [{ buyerAccountId: accountId }, { sellerAccountId: accountId }],
      createdAt: { gte: since },
    },
  });
  let pnl = 0;
  for (const t of trades) {
    const amount = Number(t.price.toString()) * Number(t.quantity.toString());
    if (t.sellerAccountId === accountId) pnl += amount;
    else pnl -= amount;
  }
  return pnl;
}

/**
 * Sum of position notionals (exposure at risk).
 * Futures: |quantity| * contractMultiplier * maxPrice (or 100).
 * Binary: (yesShares + noShares) as proxy.
 */
export async function getAgentExposure(accountId: string): Promise<number> {
  const positions = await prisma.position.findMany({
    where: { accountId },
    include: { market: true },
  });
  let total = 0;
  for (const p of positions) {
    const mult = Number((p.market.contractMultiplier ?? 1).toString());
    const maxPrice = p.market.maxPrice != null ? Number(p.market.maxPrice.toString()) : 100;
    if (isFuturesMarket(p.market)) {
      const qty = p.quantity != null ? Math.abs(Number(p.quantity.toString())) : 0;
      total += qty * mult * maxPrice;
    } else {
      const yes = Number(p.yesShares.toString());
      const no = Number(p.noShares.toString());
      total += (yes + no) * mult;
    }
  }
  return total;
}

/**
 * Last order createdAt for the account (proxy for last activity).
 */
export async function getAgentLastActivity(accountId: string): Promise<Date | null> {
  const order = await prisma.order.findFirst({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return order?.createdAt ?? null;
}
