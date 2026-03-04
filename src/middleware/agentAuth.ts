import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { getPrismaClient } from '../db/client';

const prisma = getPrismaClient();

/**
 * Optional agent auth middleware.
 * If X-Agent-Key or Authorization: Bearer <key> is present, validates against AgentProfile.
 * On success: sets req.agent and req.accountId.
 * On failure: returns 401.
 * If no key present: calls next() without setting req.agent (existing behavior).
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

  const profiles = await prisma.agentProfile.findMany({
    where: { status: 'ACTIVE' },
    include: { account: true },
  });

  for (const profile of profiles) {
    if (await bcrypt.compare(key, profile.apiKeyHash)) {
      req.agent = {
        id: profile.id,
        name: profile.name,
        accountId: profile.accountId,
      };
      req.accountId = profile.accountId;
      return next();
    }
  }

  res.status(401).json({ error: 'Invalid agent API key', code: 'INVALID_AGENT_KEY' });
}
