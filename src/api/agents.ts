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
import { getAgentPnl24h } from '../services/leaderboardService';
import { getNextRefillEta } from '../services/paperTopup';
import { formatAgentSelfProfile } from '../services/agentProfileService';
import { requireAdminKey } from '../middleware/requireAdminKey';

const router = Router();
const prisma = getPrismaClient();
const ledgerService = new LedgerService();

const createAgentSchema = z.object({
  name: z.string().min(1),
});

const STARTING_BALANCE = parseFloat(process.env.AGENT_STARTING_BALANCE ?? '10000');

router.get('/me/profile', async (req: Request, res: Response) => {
  try {
    if (!req.agent) {
      return res.status(401).json({ error: 'API key required', code: 'UNAUTHORIZED' });
    }
    const profile = await prisma.agentProfile.findUnique({
      where: { id: req.agent.id },
      include: { account: true },
    });
    if (!profile) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const [pnl24h, nextRefillEta] = await Promise.all([
      getAgentPnl24h(profile.accountId),
      getNextRefillEta(profile.accountId),
    ]);
    const opsContact = process.env.AGENT_OPS_CONTACT ?? null;
    res.json(formatAgentSelfProfile(profile, { pnl24h, nextRefillEta, opsContact }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

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
      id: result.profile.id,
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
