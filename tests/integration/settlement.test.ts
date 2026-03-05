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

async function createFuturesMarketWithPositions() {
  const [acc1, acc2] = await Promise.all([
    prisma.account.create({ data: { balance: 1000, isPaper: false } }),
    prisma.account.create({ data: { balance: 1000, isPaper: false } }),
  ]);

  const market = await prisma.market.create({
    data: {
      description: 'Futures settlement test',
      location: 'Test',
      eventDate: new Date(Date.now() + 86400000),
      condition: 'rainfall >= 10mm',
      state: MarketState.LOCKED,
      marketType: 'FUTURES',
      indexType: 'weather_rainfall',
      indexId: 'test-station',
      contractMultiplier: 1,
      lockedAt: new Date(),
    },
  });

  // acc1: long 10 contracts, acc2: short 10 (zero-sum)
  await prisma.position.upsert({
    where: {
      accountId_marketId: { accountId: acc1.id, marketId: market.id },
    },
    create: {
      accountId: acc1.id,
      marketId: market.id,
      yesShares: 0,
      noShares: 0,
      quantity: 10,
    },
    update: { quantity: 10 },
  });
  await prisma.position.upsert({
    where: {
      accountId_marketId: { accountId: acc2.id, marketId: market.id },
    },
    create: {
      accountId: acc2.id,
      marketId: market.id,
      yesShares: 0,
      noShares: 0,
      quantity: -10,
    },
    update: { quantity: -10 },
  });

  // OracleResult: index settles at 25 (e.g. 25mm rainfall)
  await prisma.oracleResult.upsert({
    where: { marketId: market.id },
    create: {
      marketId: market.id,
      outcome: 'YES',
      value: new Prisma.Decimal(25),
      source: 'test',
    },
    update: { outcome: 'YES', value: new Prisma.Decimal(25), source: 'test' },
  });

  return { market, acc1, acc2 };
}

async function cleanupSettlement(marketId: string, accountIds: string[]) {
  await prisma.settlementAudit.deleteMany({ where: { marketId } });
  await prisma.settlementStatus.deleteMany({ where: { marketId } });
  const journals = await prisma.journal.findMany({ where: { refId: marketId } });
  for (const j of journals) {
    await prisma.journalLine.deleteMany({ where: { journalId: j.id } });
    await prisma.journal.delete({ where: { id: j.id } });
  }
  await prisma.position.deleteMany({ where: { marketId } });
  await prisma.oracleResult.deleteMany({ where: { marketId } });
  await prisma.market.delete({ where: { id: marketId } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
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

    await cleanupSettlement(market.id, [acc1.id, acc2.id]);
  });

  it('locked futures market settles: long credited, short debited at index value', async () => {
    const { market, acc1, acc2 } = await createFuturesMarketWithPositions();
    const balanceBefore1 = Number((await prisma.account.findUnique({ where: { id: acc1.id } }))!.balance);
    const balanceBefore2 = Number((await prisma.account.findUnique({ where: { id: acc2.id } }))!.balance);

    const result = await settlementService.settleMarket(market.id);
    expect(result.ok).toBe(true);
    expect(result.status.state).toBe('COMPLETE');

    const marketAfter = await prisma.market.findUnique({ where: { id: market.id } });
    expect(marketAfter?.state).toBe(MarketState.SETTLED);

    // index 25, mult 1: long +10 -> +250, short -10 -> -250
    const acc1After = await prisma.account.findUnique({ where: { id: acc1.id } });
    const acc2After = await prisma.account.findUnique({ where: { id: acc2.id } });
    expect(Number(acc1After!.balance)).toBe(balanceBefore1 + 250);
    expect(Number(acc2After!.balance)).toBe(balanceBefore2 - 250);

    const audits = await prisma.settlementAudit.findMany({
      where: { marketId: market.id },
    });
    expect(audits.length).toBe(2);
    expect(Number(audits.find((a) => a.accountId === acc1.id)?.delta)).toBe(250);
    expect(Number(audits.find((a) => a.accountId === acc2.id)?.delta)).toBe(-250);

    await cleanupSettlement(market.id, [acc1.id, acc2.id]);
  });

  it('futures with contractMultiplier applies multiplier to payout', async () => {
    const [acc1, acc2] = await Promise.all([
      prisma.account.create({ data: { balance: 1000, isPaper: false } }),
      prisma.account.create({ data: { balance: 1000, isPaper: false } }),
    ]);
    const market = await prisma.market.create({
      data: {
        description: 'Futures mult test',
        location: 'Test',
        eventDate: new Date(Date.now() + 86400000),
        condition: 'rrp',
        state: MarketState.LOCKED,
        marketType: 'FUTURES',
        indexType: 'dispatch_daily_rrp',
        contractMultiplier: 10, // $/MWh -> $ payout per contract
        lockedAt: new Date(),
      },
    });
    await prisma.position.upsert({
      where: { accountId_marketId: { accountId: acc1.id, marketId: market.id } },
      create: {
        accountId: acc1.id,
        marketId: market.id,
        yesShares: 0,
        noShares: 0,
        quantity: 5,
      },
      update: { quantity: 5 },
    });
    await prisma.position.upsert({
      where: { accountId_marketId: { accountId: acc2.id, marketId: market.id } },
      create: {
        accountId: acc2.id,
        marketId: market.id,
        yesShares: 0,
        noShares: 0,
        quantity: -5,
      },
      update: { quantity: -5 },
    });
    await prisma.oracleResult.upsert({
      where: { marketId: market.id },
      create: {
        marketId: market.id,
        outcome: 'YES',
        value: new Prisma.Decimal(100),
        source: 'test',
      },
      update: { outcome: 'YES', value: new Prisma.Decimal(100), source: 'test' },
    });

    await settlementService.settleMarket(market.id);
    // 5 * 100 * 10 = 5000
    const acc1After = await prisma.account.findUnique({ where: { id: acc1.id } });
    const acc2After = await prisma.account.findUnique({ where: { id: acc2.id } });
    expect(Number(acc1After!.balance)).toBe(6000);
    expect(Number(acc2After!.balance)).toBe(-4000);

    await cleanupSettlement(market.id, [acc1.id, acc2.id]);
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

    await cleanupSettlement(market.id, [acc1.id, acc2.id]);
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

    await cleanupSettlement(market.id, [acc1.id, acc2.id]);
  });
});
