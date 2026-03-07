import type { AgentProfile, Account } from '@prisma/client';
import { getDeploymentCapDescription } from './leaderboardService';
import { getNextRefillEta } from './paperTopup';

export interface AdminProfilePayload {
  id: string;
  name: string;
  accountId: string;
  status: string;
  trustTier: string;
  startingBalance: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  account: {
    balance: number;
    isPaper: boolean;
  };
  lastDeployment: string | null;
  pnl24h: number;
  exposure: number;
  nextRefillEta: string | null;
  deploymentCap: string;
}

export interface AgentSelfProfilePayload {
  id: string;
  name: string;
  accountId: string;
  status: string;
  trustTier: string;
  startingBalance: number;
  balance: number;
  pnl24h: number;
  drawdown: number | null;
  deploymentCap: string;
  nextRefillEta: string | null;
  opsContact: string | null;
}

export interface AdminListItem {
  id: string;
  name: string;
  accountId: string;
  status: string;
  trustTier: string;
  startingBalance: number;
  deploymentCap: string;
  lastHeartbeat: string | null;
}

/**
 * Format raw profile + account + computed metrics for admin GET :id response.
 */
export function formatAdminProfile(
  profile: AgentProfile & { account: Account },
  metrics: {
    lastDeployment: Date | null;
    pnl24h: number;
    exposure: number;
    nextRefillEta: string | null;
  }
): AdminProfilePayload {
  const deploymentCap = getDeploymentCapDescription(profile.trustTier);
  return {
    id: profile.id,
    name: profile.name,
    accountId: profile.accountId,
    status: profile.status,
    trustTier: profile.trustTier,
    startingBalance: Number(profile.startingBalance.toString()),
    notes: profile.notes,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    account: {
      balance: Number(profile.account.balance.toString()),
      isPaper: profile.account.isPaper,
    },
    lastDeployment: metrics.lastDeployment?.toISOString() ?? null,
    pnl24h: metrics.pnl24h,
    exposure: metrics.exposure,
    nextRefillEta: metrics.nextRefillEta,
    deploymentCap,
  };
}

/**
 * Format for agent self-profile (GET /me/profile).
 */
export function formatAgentSelfProfile(
  profile: AgentProfile & { account: Account },
  metrics: {
    pnl24h: number;
    nextRefillEta: string | null;
    opsContact?: string | null;
  }
): AgentSelfProfilePayload {
  const balance = Number(profile.account.balance.toString());
  const starting = Number(profile.startingBalance.toString());
  const drawdown =
    starting > 0 && balance < starting
      ? (starting - balance) / starting
      : null;
  return {
    id: profile.id,
    name: profile.name,
    accountId: profile.accountId,
    status: profile.status,
    trustTier: profile.trustTier,
    startingBalance: starting,
    balance,
    pnl24h: metrics.pnl24h,
    drawdown,
    deploymentCap: getDeploymentCapDescription(profile.trustTier),
    nextRefillEta: metrics.nextRefillEta,
    opsContact: metrics.opsContact ?? null,
  };
}

/**
 * Format for admin list item (GET /admin/agents).
 */
export function formatAdminListItem(
  profile: AgentProfile & { account: Account },
  lastHeartbeat: Date | null
): AdminListItem {
  return {
    id: profile.id,
    name: profile.name,
    accountId: profile.accountId,
    status: profile.status,
    trustTier: profile.trustTier,
    startingBalance: Number(profile.startingBalance.toString()),
    deploymentCap: getDeploymentCapDescription(profile.trustTier),
    lastHeartbeat: lastHeartbeat?.toISOString() ?? null,
  };
}
