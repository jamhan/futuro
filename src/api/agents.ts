import { Router, Request, Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { getPrismaClient } from '../db/client';
import { LedgerService } from '../services/ledgerService';
import { ensureSystemAccount, SYSTEM_PAPER_ACCOUNT_ID } from '../services/systemAccount';
import { getAgentTelemetry } from '../services/leaderboardService';

const router = Router();
const prisma = getPrismaClient();
const ledgerService = new LedgerService();

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

router.get('/:id/telemetry', async (req: Request, res: Response) => {
  try {
    if (req.agent && req.agent.id !== req.params.id) {
      return res.status(403).json({ error: 'Agent can only access own telemetry' });
    }
    const data = await getAgentTelemetry(req.params.id);
    if (!data) return res.status(404).json({ error: 'Agent not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

router.post('/', requireAdminKey, async (req: Request, res: Response) => {
  try {
    const data = createAgentSchema.parse(req.body);
    const startingBalance = new Prisma.Decimal(STARTING_BALANCE);
    const apiKey = `agent_${randomUUID()}`;
    const apiKeyHash = await bcrypt.hash(apiKey, 10);
    const apiKeyLookup = createHash('sha256').update(apiKey).digest('hex');

    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          balance: 0,
          isPaper: true,
        },
      });

      const profile = await tx.agentProfile.create({
        data: {
          name: data.name,
          apiKeyHash,
          apiKeyLookup,
          startingBalance,
          accountId: account.id,
        },
      });

      // Initial balance via ledger (debit system reserve, credit agent)
      if (STARTING_BALANCE > 0) {
        await ensureSystemAccount();
        const amount = new Decimal(STARTING_BALANCE.toString());
        await ledgerService.postJournal(
          [
            {
              accountId: SYSTEM_PAPER_ACCOUNT_ID,
              debit: amount,
              credit: new Decimal(0),
            },
            {
              accountId: account.id,
              debit: new Decimal(0),
              credit: amount,
            },
          ],
          { description: 'agent_creation', refId: profile.id },
          tx as any
        );
      }

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
