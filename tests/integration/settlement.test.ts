/**
 * Settlement workflow integration tests. Requires DATABASE_URL.
 */
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { getPrismaClient } from '../../src/db/client';
import { SettlementService } from '../../src/services/settlement';
import { app } from '../../src/server';
import { MarketState, Outcome } from '../../src/domain/types';

const ADMIN_KEY = process.env.FUTURO_ADMIN_KEY || 'test-admin-key';
const prisma = getPrismaClient();
const settlementService = new SettlementService();

async function createBinaryMarketWithPositions() {
  const [acc1, acc2] = await Promise.all([
    prisma.account.create({ data: { balance: 1000, isPaper: false } }),
    prisma.account.create({ data: { balance: 1000, isPaper: false } }),
  ]);

  const market = await prisma.market.create({
    data: {
      description: 'Settlement test market',
      location: 'Test',
      eventDate: new Date(Date.now() + 86400000),
      condition: 'x > 0',
      state: MarketState.LOCKED,
      marketType: 'BINARY',
      contractMultiplier: 1,
      lockedAt: new Date(),
    },
  });

  // Create positions: acc1 holds 10 YES, acc2 holds 10 NO (matched for zero-sum)
  await prisma.position.upsert({
    where: {
      accountId_marketId: { accountId: acc1.id, marketId: market.id },
    },
    create: {
      accountId: acc1.id,
      marketId: market.id,
      yesShares: 10,
      noShares: 0,
    },
    update: { yesShares: 10, noShares: 0 },
  });
  await prisma.position.upsert({
    where: {
      accountId_marketId: { accountId: acc2.id, marketId: market.id },
    },
    create: {
      accountId: acc2.id,
      marketId: market.id,
      yesShares: 0,
      noShares: 10,
    },
    update: { yesShares: 0, noShares: 10 },
  });

  await prisma.oracleResult.upsert({
    where: { marketId: market.id },
    create: {
      marketId: market.id,
      outcome: Outcome.YES,
      value: new Prisma.Decimal(1),
      source: 'test',
    },
    update: { outcome: Outcome.YES, value: new Prisma.Decimal(1), source: 'test' },
  });

  return { market, acc1, acc2 };
}

describe('Settlement workflow', () => {
  jest.setTimeout(10000);

  it('locked market with YES winner settles properly', async () => {
    const { market, acc1, acc2 } = await createBinaryMarketWithPositions();
    const balanceBefore1 = Number((await prisma.account.findUnique({ where: { id: acc1.id } }))!.balance);
    const balanceBefore2 = Number((await prisma.account.findUnique({ where: { id: acc2.id } }))!.balance);

    const result = await settlementService.settleMarket(market.id);
    expect(result.ok).toBe(true);
    expect(result.status.state).toBe('COMPLETE');

    const marketAfter = await prisma.market.findUnique({ where: { id: market.id } });
    expect(marketAfter?.state).toBe(MarketState.SETTLED);
    expect(marketAfter?.settledAt).toBeTruthy();

    const acc1After = await prisma.account.findUnique({ where: { id: acc1.id } });
    const acc2After = await prisma.account.findUnique({ where: { id: acc2.id } });
    expect(Number(acc1After!.balance)).toBe(balanceBefore1 + 10); // YES winner: +10
    expect(Number(acc2After!.balance)).toBe(balanceBefore2 - 10); // NO loser: -10

    const audits = await prisma.settlementAudit.findMany({
      where: { marketId: market.id },
    });
    expect(audits.length).toBe(2);
    const audit1 = audits.find((a) => a.accountId === acc1.id);
    const audit2 = audits.find((a) => a.accountId === acc2.id);
    expect(audit1).toBeDefined();
    expect(Number(audit1!.delta)).toBe(10);
    expect(audit2).toBeDefined();
    expect(Number(audit2!.delta)).toBe(-10);

    // Cleanup
    await prisma.settlementAudit.deleteMany({ where: { marketId: market.id } });
    await prisma.settlementStatus.deleteMany({ where: { marketId: market.id } });
    await prisma.journalLine.deleteMany({
      where: { journal: { refId: market.id } },
    });
    await prisma.journal.deleteMany({ where: { refId: market.id } });
    await prisma.position.deleteMany({ where: { marketId: market.id } });
    await prisma.oracleResult.deleteMany({ where: { marketId: market.id } });
    await prisma.market.delete({ where: { id: market.id } });
    await prisma.account.deleteMany({ where: { id: { in: [acc1.id, acc2.id] } } });
  });

  it('re-running settlement is idempotent', async () => {
    const { market, acc1, acc2 } = await createBinaryMarketWithPositions();

    const result1 = await settlementService.settleMarket(market.id);
    expect(result1.ok).toBe(true);
    expect(result1.status.state).toBe('COMPLETE');

    const result2 = await settlementService.settleMarket(market.id);
    expect(result2.ok).toBe(true);
    expect(result2.status.state).toBe('COMPLETE');

    // No duplicate journal entries - only one settlement journal
    const journals = await prisma.journal.findMany({
      where: { refId: market.id, description: 'settlement' },
    });
    expect(journals.length).toBe(1);

    const journalLines = await prisma.journalLine.findMany({
      where: { journalId: journals[0].id },
    });
    const totalCredits = journalLines.reduce((s, l) => s + Number(l.credit), 0);
    const totalDebits = journalLines.reduce((s, l) => s + Number(l.debit), 0);
    expect(totalCredits).toBe(totalDebits);
    expect(totalCredits).toBe(10); // acc1 credit 10, acc2 debit 10

    // Cleanup
    await prisma.settlementAudit.deleteMany({ where: { marketId: market.id } });
    await prisma.settlementStatus.deleteMany({ where: { marketId: market.id } });
    await prisma.journalLine.deleteMany({ where: { journalId: journals[0].id } });
    await prisma.journal.delete({ where: { id: journals[0].id } });
    await prisma.position.deleteMany({ where: { marketId: market.id } });
    await prisma.oracleResult.deleteMany({ where: { marketId: market.id } });
    await prisma.market.delete({ where: { id: market.id } });
    await prisma.account.deleteMany({ where: { id: { in: [acc1.id, acc2.id] } } });
  });

  it('manual admin trigger returns status', async () => {
    const { market, acc1, acc2 } = await createBinaryMarketWithPositions();

    const res = await request(app)
      .post(`/api/admin/settlements/${market.id}/run`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${ADMIN_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: expect.any(Object),
    });
    expect(res.body.status).toHaveProperty('state');
    // With Redis: jobId present. Without Redis: runs sync, status.state = COMPLETE
    expect(['PENDING', 'COMPLETE', 'RUNNING']).toContain(res.body.status.state);

    const marketAfter = await prisma.market.findUnique({ where: { id: market.id } });
    expect(marketAfter?.state).toBe(MarketState.SETTLED);

    // Cleanup
    await prisma.settlementAudit.deleteMany({ where: { marketId: market.id } });
    await prisma.settlementStatus.deleteMany({ where: { marketId: market.id } });
    const journals = await prisma.journal.findMany({ where: { refId: market.id } });
    for (const j of journals) {
      await prisma.journalLine.deleteMany({ where: { journalId: j.id } });
      await prisma.journal.delete({ where: { id: j.id } });
    }
    await prisma.position.deleteMany({ where: { marketId: market.id } });
    await prisma.oracleResult.deleteMany({ where: { marketId: market.id } });
    await prisma.market.delete({ where: { id: market.id } });
    await prisma.account.deleteMany({ where: { id: { in: [acc1.id, acc2.id] } } });
  });
});
