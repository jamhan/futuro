import { Prisma } from '@prisma/client';
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

const DEFAULT_LEADERBOARD_LIMIT = 15;
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
  const [profile, valuationCount] = await Promise.all([
    prisma.agentProfile.findUnique({
      where: { id: agentId },
      include: { account: true },
    }),
    prisma.valuationSubmission.count({ where: { agentId } }),
  ]);
  if (!profile) return null;

  const balance = Number(profile.account.balance.toString());
  const starting = Number(profile.startingBalance.toString());

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
 * Uses single SQL aggregation instead of loading all trades into memory.
 */
export async function getAgentPnl24h(accountId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<
    Array<{ pnl: string | null }>
  >(Prisma.sql`
    SELECT SUM(
      CASE
        WHEN "sellerAccountId" = ${accountId} THEN ("price"::float * "quantity"::float)
        WHEN "buyerAccountId" = ${accountId} THEN -("price"::float * "quantity"::float)
        ELSE 0
      END
    ) AS pnl
    FROM trades
    WHERE ("buyerAccountId" = ${accountId} OR "sellerAccountId" = ${accountId})
      AND "createdAt" >= ${since}
  `);
  const val = rows[0]?.pnl;
  return val != null ? Number(val) : 0;
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

/**
 * Batch fetch last order createdAt per accountId. Returns Map<accountId, Date>.
 * Use for admin list to avoid N+1 queries.
 */
export async function getAgentLastActivityBatch(
  accountIds: string[]
): Promise<Map<string, Date>> {
  if (accountIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ accountId: string; createdAt: Date }>
  >(Prisma.sql`
    SELECT "accountId", MAX("createdAt") AS "createdAt"
    FROM orders
    WHERE "accountId" IN (${Prisma.join(accountIds)})
    GROUP BY "accountId"
  `);
  return new Map(rows.map((r) => [r.accountId, r.createdAt]));
}

/**
 * Batch fetch 24h PnL (trade cashflow) per accountId. Returns Map<accountId, number>.
 * Accounts with no trades in last 24h are omitted (caller can default to 0).
 */
export async function getAgentPnl24hBatch(
  accountIds: string[]
): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<
    Array<{ accountId: string; pnl: string | null }>
  >(Prisma.sql`
    SELECT sub."accountId", SUM(sub.amt)::float AS pnl
    FROM (
      SELECT "sellerAccountId" AS "accountId", ("price"::float * "quantity"::float) AS amt
      FROM trades
      WHERE "sellerAccountId" IN (${Prisma.join(accountIds)})
        AND "createdAt" >= ${since}
      UNION ALL
      SELECT "buyerAccountId", -("price"::float * "quantity"::float)
      FROM trades
      WHERE "buyerAccountId" IN (${Prisma.join(accountIds)})
        AND "createdAt" >= ${since}
    ) sub
    GROUP BY sub."accountId"
  `);
  return new Map(rows.map((r) => [r.accountId, r.pnl != null ? Number(r.pnl) : 0]));
}

/**
 * Batch fetch valuation submission count per agentId. Returns Map<agentId, number>.
 * Agents with no submissions are omitted (caller can default to 0).
 */
export async function getAgentValuationCountBatch(
  agentIds: string[]
): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ agentId: string; cnt: bigint }>
  >(Prisma.sql`
    SELECT "agentId", COUNT(*)::bigint AS cnt
    FROM valuation_submissions
    WHERE "agentId" IN (${Prisma.join(agentIds)})
    GROUP BY "agentId"
  `);
  return new Map(rows.map((r) => [r.agentId, Number(r.cnt)]));
}

export interface PublicAgentProfile {
  name: string;
  trustTier: string;
  deploymentCapDescription: string;
  balance: number;
  startingBalance: number;
  pnl24h: number;
  valuationCount: number;
  lastActivityAt: string | null;
}

const DEFAULT_PUBLIC_PROFILES_LIMIT = 15;
const MAX_PUBLIC_PROFILES_LIMIT = 100;

/**
 * Fetch public agent profiles for the profiles API.
 * Reuses batch last-activity, 24h PnL, and valuation count helpers.
 * Sorted by trust tier (TRUSTED first) then balance descending.
 */
export async function getPublicAgentProfiles(
  limit = DEFAULT_PUBLIC_PROFILES_LIMIT
): Promise<PublicAgentProfile[]> {
  const take = Math.min(Math.max(1, limit), MAX_PUBLIC_PROFILES_LIMIT);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      accountId: string;
      trustTier: string;
      balance: unknown;
      startingBalance: unknown;
    }>
  >(Prisma.sql`
    SELECT ap.id, ap.name, ap."accountId", ap."trustTier",
           a.balance::float,
           ap."startingBalance"::float
    FROM agent_profiles ap
    JOIN accounts a ON a.id = ap."accountId"
    WHERE ap.status = 'ACTIVE'
    ORDER BY
      CASE ap."trustTier"
        WHEN 'TRUSTED' THEN 0
        WHEN 'VERIFIED' THEN 1
        ELSE 2
      END,
      a.balance::float DESC
    LIMIT ${take}
  `);

  if (rows.length === 0) return [];

  const accountIds = rows.map((r) => r.accountId);
  const agentIds = rows.map((r) => r.id);

  const [lastActivityMap, pnl24hMap, valuationCountMap] = await Promise.all([
    getAgentLastActivityBatch(accountIds),
    getAgentPnl24hBatch(accountIds),
    getAgentValuationCountBatch(agentIds),
  ]);

  return rows.map((r) => {
    const balance = Number(r.balance);
    const startingBalance = Number(r.startingBalance);
    const lastActivity = lastActivityMap.get(r.accountId) ?? null;
    return {
      name: r.name,
      trustTier: r.trustTier,
      deploymentCapDescription: getDeploymentCapDescription(r.trustTier),
      balance,
      startingBalance,
      pnl24h: pnl24hMap.get(r.accountId) ?? 0,
      valuationCount: valuationCountMap.get(r.id) ?? 0,
      lastActivityAt: lastActivity?.toISOString() ?? null,
    };
  });
}
