import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { OracleIngestor } from '../services/oracleIngestor';
import { getPrismaClient } from '../db/client';

const router = Router();
const prisma = getPrismaClient();

const patchTrustSchema = z.object({
  trustTier: z.enum(['UNVERIFIED', 'VERIFIED', 'TRUSTED']),
});
const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY;

function requireAdminKey(req: Request, res: Response, next: () => void): void {
  if (!ADMIN_KEY) {
    res.status(503).json({
      error: 'Admin operations disabled: FUTURO_ADMIN_KEY not configured',
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

router.post('/oracle/import', requireAdminKey, async (req, res) => {
  try {
    const ingestor = new OracleIngestor();
    const dataDir = (req.body?.dataDir as string) || undefined;
    const result = await ingestor.ingestFromFiles(dataDir);
    res.json({
      filesRead: result.filesRead,
      observationsCreated: result.observationsCreated,
      observationsUpdated: result.observationsUpdated,
      marketsResolved: result.marketsResolved,
      errors: result.errors,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Ingestion failed',
    });
  }
});

router.patch('/agents/:id/trust', requireAdminKey, async (req, res) => {
  try {
    const body = patchTrustSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: body.error.errors });
    }
    const profile = await prisma.agentProfile.findUnique({
      where: { id: req.params.id },
    });
    if (!profile) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const updated = await prisma.agentProfile.update({
      where: { id: req.params.id },
      data: { trustTier: body.data.trustTier },
    });
    res.json({
      id: updated.id,
      name: updated.name,
      trustTier: updated.trustTier,
      accountId: updated.accountId,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update trust tier',
    });
  }
});

export default router;
