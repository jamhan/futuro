import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from '../db/client';

const router = Router();
const prisma = getPrismaClient();

const createAgentSchema = z.object({
  name: z.string().min(1),
});

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY;
const STARTING_BALANCE = parseFloat(process.env.AGENT_STARTING_BALANCE ?? '10000');

function requireAdminKey(req: Request, res: Response, next: () => void): void {
  if (!ADMIN_KEY) {
    res.status(503).json({
      error: 'Agent creation disabled: FUTURO_ADMIN_KEY not configured',
      code: 'ADMIN_KEY_NOT_SET',
    });
    return;
  }
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  if (bearer !== ADMIN_KEY) {
    res.status(401).json({
      error: 'Invalid or missing admin key',
      code: 'UNAUTHORIZED',
    });
    return;
  }
  next();
}

router.post('/', requireAdminKey, async (req: Request, res: Response) => {
  try {
    const data = createAgentSchema.parse(req.body);
    const startingBalance = new Prisma.Decimal(STARTING_BALANCE);
    const apiKey = `agent_${randomUUID()}`;
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          balance: startingBalance,
          isPaper: true,
        },
      });

      const profile = await tx.agentProfile.create({
        data: {
          name: data.name,
          apiKeyHash,
          startingBalance,
          accountId: account.id,
        },
      });

      return { account, profile };
    });

    res.status(201).json({
      apiKey,
      accountId: result.account.id,
      name: result.profile.name,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

export default router;
