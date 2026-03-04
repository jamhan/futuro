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

/**
 * Compute PnL as (current balance - starting balance) for each agent.
 * Brier and log-loss from valuation vs auction clearing (when we have data).
 */
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const profiles = await prisma.agentProfile.findMany({
    where: { status: 'ACTIVE' },
    include: { account: true },
  });

  const entries: LeaderboardEntry[] = profiles.map((p) => {
    const balance = Number(p.account.balance.toString());
    const starting = Number(p.startingBalance.toString());
    const pnl = balance - starting;
    return {
      agentId: p.id,
      agentName: p.name,
      accountId: p.accountId,
      pnl,
      balance,
      startingBalance: starting,
    };
  });

  entries.sort((a, b) => b.pnl - a.pnl);
  return entries;
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
