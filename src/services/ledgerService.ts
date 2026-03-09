import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { ledgerJournalsTotal } from './metrics';

const D_ZERO = new Decimal(0);

export interface JournalLineInput {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
}

export interface PostJournalOptions {
  description: string;
  refId?: string;
}

type PrismaTx = Omit<
  Parameters<Parameters<ReturnType<typeof getPrismaClient>['$transaction']>[0]>[0],
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * LedgerService: double-entry bookkeeping.
 * All balance mutations flow through journals. Balance = sum(credits) - sum(debits).
 */
export class LedgerService {
  private prisma = getPrismaClient();

  /**
   * Post a journal entry. Validates sum(debits) = sum(credits), creates Journal + lines, updates Account.balance.
   * @param lines - Balanced journal lines (sum debits must equal sum credits)
   * @param options - description and optional refId
   * @param tx - Optional Prisma transaction client (for use inside $transaction)
   */
  async postJournal(
    lines: JournalLineInput[],
    options: PostJournalOptions,
    tx?: PrismaTx
  ): Promise<string> {
    const client = tx ?? this.prisma;

    const totalDebit = lines.reduce((sum, l) => sum.plus(l.debit), D_ZERO);
    const totalCredit = lines.reduce((sum, l) => sum.plus(l.credit), D_ZERO);
    if (!totalDebit.minus(totalCredit).isZero()) {
      throw new Error(
        `Journal unbalanced: debits=${totalDebit} credits=${totalCredit}`
      );
    }

    const journal = await client.journal.create({
      data: {
        description: options.description,
        refId: options.refId ?? null,
      },
    });

    const accountDeltas = new Map<string, Decimal>();
    const linesToCreate: {
      journalId: string;
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }[] = [];

    for (const line of lines) {
      const delta = line.credit.minus(line.debit);
      if (!delta.isZero()) {
        accountDeltas.set(
          line.accountId,
          (accountDeltas.get(line.accountId) ?? D_ZERO).plus(delta)
        );
        linesToCreate.push({
          journalId: journal.id,
          accountId: line.accountId,
          debit: new Prisma.Decimal(line.debit.toString()),
          credit: new Prisma.Decimal(line.credit.toString()),
        });
      }
    }

    if (linesToCreate.length > 0) {
      await client.journalLine.createMany({ data: linesToCreate });
    }

    const accountIds = [...accountDeltas.keys()];
    if (accountIds.length > 0) {
      const accounts = await client.account.findMany({
        where: { id: { in: accountIds } },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      for (const [accountId, delta] of accountDeltas.entries()) {
        const acc = accountMap.get(accountId);
        if (!acc) continue;
        const newBalance = new Decimal(acc.balance.toString()).plus(delta);
        await client.account.update({
          where: { id: accountId },
          data: { balance: new Prisma.Decimal(newBalance.toString()) },
        });
      }
    }

    ledgerJournalsTotal.inc({ description: options.description });
    return journal.id;
  }
}
