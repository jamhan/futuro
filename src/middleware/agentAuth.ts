import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import bcrypt from 'bcrypt';
import { getPrismaClient } from '../db/client';

const prisma = getPrismaClient();

/**
 * Optional agent auth middleware.
 * If X-Agent-Key or Authorization: Bearer <key> is present, validates against AgentProfile.
 * On success: sets req.agent and req.accountId.
 * On failure: returns 401.
 * If no key present: calls next() without setting req.agent (existing behavior).
 *
 * Uses apiKeyLookup (SHA-256) for O(1) indexed lookup. Falls back to legacy scan only for
 * agents created before apiKeyLookup was introduced.
 */
export async function agentAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const key =
    (req.headers['x-agent-key'] as string) ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined);

  if (!key || !key.startsWith('agent_')) {
    return next();
  }

  const lookup = createHash('sha256').update(key).digest('hex');

  // Fast path: O(1) lookup by SHA-256
  const byLookup = await prisma.agentProfile.findUnique({
    where: { apiKeyLookup: lookup },
    include: { account: true },
  });

  if (byLookup) {
    if (byLookup.status !== 'ACTIVE') {
      res.status(401).json({ error: 'Agent suspended', code: 'INVALID_AGENT_KEY' });
      return;
    }
    if (await bcrypt.compare(key, byLookup.apiKeyHash)) {
      req.agent = {
        id: byLookup.id,
        name: byLookup.name,
        accountId: byLookup.accountId,
        trustTier: byLookup.trustTier ?? 'UNVERIFIED',
      };
      req.accountId = byLookup.accountId;
      return next();
    }
  }

  // Fallback: legacy agents without apiKeyLookup (small set, shrinks over time)
  // Short-circuit when none exist — avoids O(n) bcrypt for invalid keys
  const legacyCount = await prisma.agentProfile.count({
    where: { status: 'ACTIVE', apiKeyLookup: null },
  });
  if (legacyCount === 0) {
    res.status(401).json({ error: 'Invalid agent API key', code: 'INVALID_AGENT_KEY' });
    return;
  }

  const legacyProfiles = await prisma.agentProfile.findMany({
    where: { status: 'ACTIVE', apiKeyLookup: null },
    include: { account: true },
  });

  for (const profile of legacyProfiles) {
    if (await bcrypt.compare(key, profile.apiKeyHash)) {
      // Migrate to apiKeyLookup so future auth uses fast path
      await prisma.agentProfile.update({
        where: { id: profile.id },
        data: { apiKeyLookup: lookup },
      }).catch(() => { /* ignore update failure, auth still succeeds */ });
      req.agent = {
        id: profile.id,
        name: profile.name,
        accountId: profile.accountId,
        trustTier: profile.trustTier ?? 'UNVERIFIED',
      };
      req.accountId = profile.accountId;
      return next();
    }
  }

  res.status(401).json({ error: 'Invalid agent API key', code: 'INVALID_AGENT_KEY' });
}
