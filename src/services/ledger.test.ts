/**
 * Ledger service tests. Requires DATABASE_URL.
 */
import Decimal from 'decimal.js';
import { getPrismaClient } from '../db/client';
import { LedgerService } from './ledgerService';
import { ensureSystemAccount, SYSTEM_PAPER_ACCOUNT_ID } from './systemAccount';

const prisma = getPrismaClient();
const ledger = new LedgerService();

describe('LedgerService', () => {
  beforeAll(async () => {
    await ensureSystemAccount();
  });

  it('posts balanced journal and updates account', async () => {
    const account = await prisma.account.create({
      data: { balance: 0, isPaper: false },
    });
    const amount = new Decimal(100);
    await ledger.postJournal(
      [
        { accountId: SYSTEM_PAPER_ACCOUNT_ID, debit: amount, credit: new Decimal(0) },
        { accountId: account.id, debit: new Decimal(0), credit: amount },
      ],
      { description: 'test_transfer', refId: 'test-1' }
    );
    const updated = await prisma.account.findUnique({
      where: { id: account.id },
    });
    expect(Number(updated?.balance)).toBe(100);

    const lines = await prisma.journalLine.findMany({
      where: { accountId: account.id },
    });
    expect(lines.length).toBe(1);
    expect(Number(lines[0].credit)).toBe(100);

    const journalIds = await prisma.journalLine.findMany({
      where: { accountId: account.id },
      select: { journalId: true },
    }).then((r) => r.map((l) => l.journalId));
    await prisma.journalLine.deleteMany({ where: { journalId: { in: journalIds } } });
    await prisma.journal.deleteMany({ where: { id: { in: journalIds } } });
    await prisma.account.delete({ where: { id: account.id } });
  });

  it('rejects unbalanced journal', async () => {
    const account = await prisma.account.create({
      data: { balance: 0, isPaper: false },
    });
    await expect(
      ledger.postJournal(
        [{ accountId: account.id, debit: new Decimal(0), credit: new Decimal(100) }],
        { description: 'unbalanced' }
      )
    ).rejects.toThrow(/unbalanced/);
    await prisma.account.delete({ where: { id: account.id } });
  });
});
