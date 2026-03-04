/**
 * Paper top-up service tests. Requires DATABASE_URL.
 */
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { resetPaperBalance, runPaperTopupJob } from './paperTopup';

const prisma = getPrismaClient();

describe('paperTopup', () => {
  let agentAccountId: string;

  beforeAll(async () => {
    const account = await prisma.account.create({
      data: { balance: 10000, isPaper: true },
    });
    agentAccountId = account.id;
    await prisma.agentProfile.create({
      data: {
        name: 'paper-topup-test-agent',
        apiKeyHash: await bcrypt.hash('agent_test_key', 10),
        startingBalance: new Prisma.Decimal(10000),
        accountId: account.id,
      },
    });
  });

  afterAll(async () => {
    if (agentAccountId) {
      await prisma.agentProfile.deleteMany({ where: { accountId: agentAccountId } });
      await prisma.account.delete({ where: { id: agentAccountId } });
    }
  });

  describe('resetPaperBalance', () => {
    it('resets account balance to startingBalance when below threshold', async () => {
      await prisma.account.update({
        where: { id: agentAccountId },
        data: { balance: 500 },
      });

      await resetPaperBalance(agentAccountId);

      const account = await prisma.account.findUnique({
        where: { id: agentAccountId },
      });
      expect(Number(account?.balance)).toBe(10000);
    });

    it('does nothing for non-paper account', async () => {
      const regularAccount = await prisma.account.create({
        data: { balance: 100, isPaper: false },
      });
      await prisma.account.update({
        where: { id: regularAccount.id },
        data: { balance: 50 },
      });

      await resetPaperBalance(regularAccount.id);

      const account = await prisma.account.findUnique({
        where: { id: regularAccount.id },
      });
      expect(Number(account?.balance)).toBe(50);

      await prisma.account.delete({ where: { id: regularAccount.id } });
    });
  });

  describe('runPaperTopupJob', () => {
    it('tops up agent accounts with balance below threshold', async () => {
      await prisma.account.update({
        where: { id: agentAccountId },
        data: { balance: 1000 },
      });

      await runPaperTopupJob();

      const account = await prisma.account.findUnique({
        where: { id: agentAccountId },
      });
      expect(Number(account?.balance)).toBe(10000);
    });
  });
});
