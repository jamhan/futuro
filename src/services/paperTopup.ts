import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { LedgerService } from './ledgerService';
import { ensureSystemAccount, SYSTEM_PAPER_ACCOUNT_ID } from './systemAccount';
import { agentLiquidationsTotal } from './metrics';

const prisma = getPrismaClient();
const ledgerService = new LedgerService();

const TOPUP_THRESHOLD = parseFloat(process.env.AGENT_TOPUP_THRESHOLD ?? '2000');

export async function resetPaperBalance(accountId: string): Promise<void> {
  const profile = await prisma.agentProfile.findUnique({
    where: { accountId },
    include: { account: true },
  });

  if (!profile || !profile.account.isPaper) {
    return;
  }

  const currentBalance = new Decimal(profile.account.balance.toString());
  const startingBalance = new Decimal(profile.startingBalance.toString());
  const delta = startingBalance.minus(currentBalance);

  if (delta.isZero()) {
    return;
  }

  await ensureSystemAccount();

  const lines = delta.gt(0)
    ? [
        { accountId: SYSTEM_PAPER_ACCOUNT_ID, debit: delta, credit: new Decimal(0) },
        { accountId, debit: new Decimal(0), credit: delta },
      ]
    : [
        { accountId, debit: delta.abs(), credit: new Decimal(0) },
        { accountId: SYSTEM_PAPER_ACCOUNT_ID, debit: new Decimal(0), credit: delta.abs() },
      ];

  await ledgerService.postJournal(lines, {
    description: 'paper_topup',
    refId: profile.id,
  });

  agentLiquidationsTotal.inc({ agent_id: profile.id });

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
