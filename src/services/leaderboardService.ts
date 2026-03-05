import Decimal from 'decimal.js';
import { getPrismaClient } from '../db/client';

const prisma = getPrismaClient();

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
