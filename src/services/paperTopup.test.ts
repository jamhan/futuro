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

    it('does not touch accounts above threshold', async () => {
      await prisma.account.update({
        where: { id: agentAccountId },
        data: { balance: 5000 },
      });

      await runPaperTopupJob();

      const account = await prisma.account.findUnique({
        where: { id: agentAccountId },
      });
      expect(Number(account?.balance)).toBe(5000);
    });

    it('does not touch suspended agent accounts', async () => {
      const account = await prisma.account.create({
        data: { balance: 500, isPaper: true },
      });
      await prisma.agentProfile.create({
        data: {
          name: 'suspended-agent',
          apiKeyHash: await bcrypt.hash('agent_suspended_key', 10),
          startingBalance: new Prisma.Decimal(10000),
          accountId: account.id,
          status: 'SUSPENDED',
        },
      });

      await runPaperTopupJob();

      const updated = await prisma.account.findUnique({
        where: { id: account.id },
      });
      expect(Number(updated?.balance)).toBe(500);

      await prisma.agentProfile.deleteMany({ where: { accountId: account.id } });
      await prisma.account.delete({ where: { id: account.id } });
    });
  });

  describe('resetPaperBalance edge cases', () => {
    it('does nothing for paper account with no AgentProfile', async () => {
      const orphanPaper = await prisma.account.create({
        data: { balance: 100, isPaper: true },
      });

      await resetPaperBalance(orphanPaper.id);

      const account = await prisma.account.findUnique({
        where: { id: orphanPaper.id },
      });
      expect(Number(account?.balance)).toBe(100);

      await prisma.account.delete({ where: { id: orphanPaper.id } });
    });
  });
});
