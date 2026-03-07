import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { OracleIngestor } from '../services/oracleIngestor';
import { getPrismaClient } from '../db/client';
import { SettlementService } from '../services/settlement';
import {
  getDeploymentCapDescription,
  getAgentLastActivity,
  getAgentPnl24h,
  getAgentExposure,
} from '../services/leaderboardService';
import { getNextRefillEta } from '../services/paperTopup';
import { formatAdminProfile, formatAdminListItem } from '../services/agentProfileService';

const router = Router();
const prisma = getPrismaClient();
const settlementService = new SettlementService();

const patchTrustSchema = z.object({
  trustTier: z.enum(['UNVERIFIED', 'VERIFIED', 'TRUSTED']),
});

const listAgentsQuerySchema = z.object({
  page: z.string().optional().transform((s) => (s ? parseInt(s, 10) : 1)),
  limit: z.string().optional().transform((s) => (s ? parseInt(s, 10) : 20)),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  trustTier: z.enum(['UNVERIFIED', 'VERIFIED', 'TRUSTED']).optional(),
  q: z.string().optional(),
});

const patchAgentSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  trustTier: z.enum(['UNVERIFIED', 'VERIFIED', 'TRUSTED']).optional(),
  startingBalance: z.number().positive().optional(),
  notes: z.string().nullable().optional(),
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

router.post('/settlements/:marketId/run', requireAdminKey, async (req, res) => {
  try {
    const { marketId } = req.params;
    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { oracleResult: true, settlementStatus: true },
    });
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    let jobId: string | undefined;
    try {
      const { enqueueSettlement } = await import('../queues/settlementQueue');
      jobId = await enqueueSettlement(marketId);
    } catch {
      // Redis down: run settlement synchronously
      const result = await settlementService.settleMarket(marketId);
      return res.json({
        jobId: null,
        status: result.status,
      });
    }
    const status = await settlementService.getSettlementStatus(marketId);
    res.json({
      jobId,
      status: status ?? { state: 'PENDING' },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enqueue settlement',
    });
  }
});

router.get('/agents', requireAdminKey, async (req, res) => {
  try {
    const query = listAgentsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: query.error.errors });
    }
    const { page, limit, status, trustTier, q } = query.data;
    const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
    const take = Math.min(100, Math.max(1, limit));

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (trustTier) where.trustTier = trustTier;
    if (q && q.trim()) {
      where.OR = [
        { name: { contains: q.trim(), mode: 'insensitive' as const } },
        { accountId: { contains: q.trim(), mode: 'insensitive' as const } },
      ];
    }

    const [profiles, total] = await Promise.all([
      prisma.agentProfile.findMany({
        where,
        include: { account: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.agentProfile.count({ where }),
    ]);

    const items = await Promise.all(
      profiles.map(async (p) => {
        const lastHeartbeat = await getAgentLastActivity(p.accountId);
        return formatAdminListItem(p, lastHeartbeat);
      })
    );

    res.json({
      items,
      total,
      page: Math.max(1, page),
      limit: take,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to list agents',
    });
  }
});

router.get('/agents/:id', requireAdminKey, async (req, res) => {
  try {
    const profile = await prisma.agentProfile.findUnique({
      where: { id: req.params.id },
      include: { account: true },
    });
    if (!profile) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const [lastDeployment, pnl24h, exposure, nextRefillEta] = await Promise.all([
      getAgentLastActivity(profile.accountId),
      getAgentPnl24h(profile.accountId),
      getAgentExposure(profile.accountId),
      getNextRefillEta(profile.accountId),
    ]);
    const payload = formatAdminProfile(profile, {
      lastDeployment,
      pnl24h,
      exposure,
      nextRefillEta,
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get agent',
    });
  }
});

router.patch('/agents/:id', requireAdminKey, async (req, res) => {
  try {
    const body = patchAgentSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: body.error.errors });
    }
    const profile = await prisma.agentProfile.findUnique({
      where: { id: req.params.id },
    });
    if (!profile) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const data: Record<string, unknown> = {};
    if (body.data.status !== undefined) data.status = body.data.status;
    if (body.data.trustTier !== undefined) data.trustTier = body.data.trustTier;
    if (body.data.notes !== undefined) data.notes = body.data.notes;
    if (body.data.startingBalance !== undefined) {
      data.startingBalance = new Prisma.Decimal(body.data.startingBalance);
    }
    const updated = await prisma.agentProfile.update({
      where: { id: req.params.id },
      data,
      include: { account: true },
    });
    const [lastDeployment, pnl24h, exposure, nextRefillEta] = await Promise.all([
      getAgentLastActivity(updated.accountId),
      getAgentPnl24h(updated.accountId),
      getAgentExposure(updated.accountId),
      getNextRefillEta(updated.accountId),
    ]);
    res.json(
      formatAdminProfile(updated, {
        lastDeployment,
        pnl24h,
        exposure,
        nextRefillEta,
      })
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update agent',
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
