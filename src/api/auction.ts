import { Router, Request, Response } from 'express';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { getPrismaClient } from '../db/client';

const router = Router();
const prisma = getPrismaClient();

function getCurrentIntervalId(): string {
  const d = new Date();
  return d.toISOString().slice(0, 13).replace('T', 'T'); // YYYY-MM-DDTHH
}

const valuationSchema = z.object({
  marketId: z.string(),
  fairValue: z.number(),
  lowerBand: z.number(),
  upperBand: z.number(),
});

const valuationsSchema = z.union([
  valuationSchema,
  z.array(valuationSchema),
]);

router.post('/valuations', async (req: Request, res: Response) => {
  try {
    if (!req.agent) {
      return res.status(401).json({
        error: 'X-Agent-Key required',
        code: 'AGENT_REQUIRED',
      });
    }

    const data = valuationsSchema.parse(req.body);
    const items = Array.isArray(data) ? data : [data];
    const intervalId = getCurrentIntervalId();

    for (const item of items) {
      await prisma.valuationSubmission.upsert({
        where: {
          agentId_marketId_intervalId: {
            agentId: req.agent.id,
            marketId: item.marketId,
            intervalId,
          },
        },
        create: {
          agentId: req.agent.id,
          marketId: item.marketId,
          intervalId,
          fairValue: item.fairValue,
          lowerBand: item.lowerBand,
          upperBand: item.upperBand,
        },
        update: {
          fairValue: item.fairValue,
          lowerBand: item.lowerBand,
          upperBand: item.upperBand,
        },
      });
    }

    res.status(201).json({
      intervalId,
      submitted: items.length,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

export default router;
