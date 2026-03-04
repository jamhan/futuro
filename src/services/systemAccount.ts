import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';

/** System account used as contra for paper topups and agent creation. */
export const SYSTEM_PAPER_ACCOUNT_ID = 'system-paper-reserve';

const LARGE_BALANCE = 10_000_000;

let ensured = false;

/**
 * Ensure the system paper reserve account exists. Idempotent.
 * Call before posting journals that credit agent accounts (topup, creation).
 */
export async function ensureSystemAccount(): Promise<void> {
  if (ensured) return;

  const prisma = getPrismaClient();
  await prisma.account.upsert({
    where: { id: SYSTEM_PAPER_ACCOUNT_ID },
    create: {
      id: SYSTEM_PAPER_ACCOUNT_ID,
      balance: new Prisma.Decimal(LARGE_BALANCE),
      isPaper: false,
    },
    update: {},
  });
  ensured = true;
}
