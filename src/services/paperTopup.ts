import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { AccountRepository } from '../repositories/accountRepository';

const prisma = getPrismaClient();
const accountRepo = new AccountRepository();

const TOPUP_THRESHOLD = parseFloat(process.env.AGENT_TOPUP_THRESHOLD ?? '2000');

export async function resetPaperBalance(accountId: string): Promise<void> {
  const profile = await prisma.agentProfile.findUnique({
    where: { accountId },
    include: { account: true },
  });

  if (!profile || !profile.account.isPaper) {
    return;
  }

  const startingBalance = new Decimal(profile.startingBalance.toString());
  await accountRepo.updateBalance(accountId, startingBalance);

  console.log(
    `[paperTopup] Reset account ${accountId} (agent: ${profile.name}) to balance ${profile.startingBalance}`
  );
}

export async function runPaperTopupJob(): Promise<void> {
  const threshold = new Prisma.Decimal(TOPUP_THRESHOLD);

  const profiles = await prisma.agentProfile.findMany({
    where: {
      status: 'ACTIVE',
      account: {
        isPaper: true,
        balance: { lt: threshold },
      },
    },
    include: { account: true },
  });

  for (const profile of profiles) {
    await resetPaperBalance(profile.accountId);
  }
}
