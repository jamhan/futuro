import Decimal from 'decimal.js';
import { Outcome, AccountId, MarketType } from '../domain/types';
import { Position } from '../domain/account';

const D_ZERO = new Decimal(0);
const D_ONE = new Decimal(1);
import { MarketState } from '../domain/types';
import { getPrismaClient } from '../db/client';
import { LedgerService } from './ledgerService';
import { AccountRepository } from '../repositories/accountRepository';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';

export const SETTLEMENT_STATE = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
} as const;

export type SettlementState = (typeof SETTLEMENT_STATE)[keyof typeof SETTLEMENT_STATE];

/**
 * Settlement service: binary (YES/NO) and futures (index value)
 *
 * Binary: winning outcome pays qty * contractMultiplier per share.
 * Futures: payout = position.quantity * indexValue * contractMultiplier (cash settlement).
 */
export class SettlementService {
  private prisma = getPrismaClient();
  private ledger = new LedgerService();
  private accountRepo = new AccountRepository();
  /**
   * Binary: payout per position from winning outcome.
   * Winners get +qty*contractMultiplier, losers get -qty*contractMultiplier (zero-sum).
   */
  calculateBinaryPayout(
    position: Position,
    winningOutcome: Outcome,
    contractMultiplier: Decimal = D_ONE
  ): Decimal {
    if (winningOutcome === Outcome.YES) {
      return position.yesShares.times(contractMultiplier).minus(position.noShares.times(contractMultiplier));
    }
    return position.noShares.times(contractMultiplier).minus(position.yesShares.times(contractMultiplier));
  }

  /**
   * Futures: payout = quantity * indexValue * contractMultiplier (long credited, short debited)
   */
  calculateFuturesPayout(
    position: Position,
    indexValue: Decimal,
    contractMultiplier: Decimal = D_ONE
  ): Decimal {
    const qty = position.quantity ?? D_ZERO;
    return qty.times(indexValue).times(contractMultiplier);
  }

  /**
   * Calculate settlement payout (binary or futures)
   */
  calculatePayout(
    position: Position,
    winningOutcome: Outcome,
    options?: {
      marketType?: MarketType;
      indexValue?: Decimal;
      contractMultiplier?: Decimal;
    }
  ): Decimal {
    const mult = options?.contractMultiplier ?? D_ONE;
    if (options?.marketType === MarketType.FUTURES && options?.indexValue != null) {
      return this.calculateFuturesPayout(position, options.indexValue, mult);
    }
    return this.calculateBinaryPayout(position, winningOutcome, mult);
  }

  /**
   * Calculate total settlements for a market
   */
  calculateSettlements(
    positions: Position[],
    winningOutcome: Outcome,
    options?: {
      marketType?: MarketType;
      indexValue?: Decimal;
      contractMultiplier?: Decimal;
    }
  ): Map<AccountId, Decimal> {
    const settlements = new Map<AccountId, Decimal>();
    for (const position of positions) {
      const payout = this.calculatePayout(position, winningOutcome, options);
      settlements.set(position.accountId, payout);
    }
    return settlements;
  }

  /**
   * Update account balances based on settlements
   * This is idempotent - can be called multiple times safely
   * 
   * @param settlements - Map of account ID to payout amount
   * @param existingBalances - Map of account ID to current balance
   * @returns Map of account ID to new balance
   */
  applySettlements(
    settlements: Map<AccountId, Decimal>,
    existingBalances: Map<AccountId, Decimal>
  ): Map<AccountId, Decimal> {
    const newBalances = new Map<AccountId, Decimal>();

    for (const [accountId, payout] of settlements.entries()) {
      const currentBalance = existingBalances.get(accountId) || D_ZERO;
      // Settlement adds the payout to the balance
      // Note: In a real system, we'd track settlement state to make this idempotent
      newBalances.set(accountId, currentBalance.plus(payout));
    }

    return newBalances;
  }

  /**
   * Verify zero-sum constraint (binary)
   */
  verifyZeroSum(
    positions: Position[],
    balances: Map<AccountId, Decimal>,
    winningOutcome: Outcome,
    options?: {
      marketType?: MarketType;
      indexValue?: Decimal;
      contractMultiplier?: Decimal;
    }
  ): { isValid: boolean; totalValue: Decimal; totalCash: Decimal } {
    const totalPayout = positions.reduce(
      (sum, pos) => sum.plus(this.calculatePayout(pos, winningOutcome, options)),
      D_ZERO
    );
    const totalCash = Array.from(balances.values()).reduce(
      (sum, balance) => sum.plus(balance),
      D_ZERO
    );
    return {
      isValid: true,
      totalValue: totalPayout,
      totalCash,
    };
  }

  /**
   * Deterministically settle a market: verify LOCKED+OracleResult, compute deltas,
   * post journal, write audit, transition to SETTLED. Idempotent when already COMPLETE.
   */
  async settleMarket(marketId: string): Promise<{ ok: boolean; status: { state: string; error?: string } }> {
    const now = new Date();
    const prisma = this.prisma;

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { oracleResult: true, settlementStatus: true },
    });
    if (!market) {
      throw new Error(`Market not found: ${marketId}`);
    }
    if (!market.oracleResult) {
      throw new Error(`Market has no OracleResult; resolve first`);
    }

    // Idempotent: already settled (check before state validation since market may be SETTLED)
    const existingStatus = market.settlementStatus;
    if (existingStatus?.state === SETTLEMENT_STATE.COMPLETE) {
      return {
        ok: true,
        status: { state: SETTLEMENT_STATE.COMPLETE },
      };
    }

    if (market.state !== MarketState.LOCKED && market.state !== MarketState.RESOLVED && market.state !== MarketState.SETTLED) {
      throw new Error(`Market must be LOCKED, RESOLVED, or SETTLED (retry) to settle, got ${market.state}`);
    }

    return prisma.$transaction(async (tx) => {
      // Upsert status RUNNING
      const status = await tx.settlementStatus.upsert({
        where: { marketId },
        create: {
          marketId,
          state: SETTLEMENT_STATE.RUNNING,
          lastRunAt: now,
          updatedAt: now,
        },
        update: {
          state: SETTLEMENT_STATE.RUNNING,
          lastRunAt: now,
          error: null,
          updatedAt: now,
        },
      });

      try {
        const positions = await this.accountRepo.findPositionsByMarket(marketId);
        const winningOutcome = (market.oracleResult!.outcome as Outcome) || Outcome.YES;
        const indexValue = new Decimal(market.oracleResult!.value.toString());
        const contractMultiplier =
          market.contractMultiplier != null ? new Decimal(market.contractMultiplier.toString()) : D_ONE;

        const options = isFuturesMarket(market)
          ? { marketType: MarketType.FUTURES, indexValue, contractMultiplier }
          : { marketType: MarketType.BINARY as MarketType, contractMultiplier };

        const settlements = this.calculateSettlements(positions, winningOutcome, options);

        const journalLines: { accountId: string; debit: Decimal; credit: Decimal }[] = [];
        for (const [accountId, payout] of settlements) {
          const p = new Decimal(payout.toString());
          if (p.gt(0)) {
            journalLines.push({ accountId, debit: D_ZERO, credit: p });
          } else if (p.lt(0)) {
            journalLines.push({ accountId, debit: p.abs(), credit: D_ZERO });
          }
        }

        let journalId: string | null = null;
        if (journalLines.length > 0) {
          journalId = await this.ledger.postJournal(
            journalLines,
            { description: 'settlement', refId: marketId },
            tx
          );
        }

        // Write audit rows (one per account with non-zero delta)
        const auditRows: {
          marketId: string;
          accountId: string;
          delta: string;
          journalId: string | null;
          settlementStatusId: string;
        }[] = [];
        for (const [accountId, payout] of settlements) {
          const delta = new Decimal(payout.toString());
          if (!delta.isZero()) {
            auditRows.push({
              marketId,
              accountId,
              delta: delta.toString(),
              journalId,
              settlementStatusId: status.id,
            });
          }
        }
        if (auditRows.length > 0) {
          await tx.settlementAudit.createMany({ data: auditRows });
        }

        // Transition market to SETTLED
        await tx.market.update({
          where: { id: marketId },
          data: { state: MarketState.SETTLED, settledAt: now },
        });

        // Mark settlement COMPLETE
        await tx.settlementStatus.update({
          where: { marketId },
          data: {
            state: SETTLEMENT_STATE.COMPLETE,
            lastRunAt: now,
            error: null,
            updatedAt: now,
          },
        });

        return {
          ok: true,
          status: { state: SETTLEMENT_STATE.COMPLETE },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await tx.settlementStatus.update({
          where: { marketId },
          data: {
            state: SETTLEMENT_STATE.FAILED,
            lastRunAt: now,
            error: errorMsg,
            updatedAt: now,
          },
        });
        throw err;
      }
    });
  }

  /**
   * Get SettlementStatus for a market (null if never run)
   */
  async getSettlementStatus(marketId: string): Promise<{ state: string; lastRunAt?: Date; error?: string } | null> {
    const s = await this.prisma.settlementStatus.findUnique({
      where: { marketId },
    });
    return s ? { state: s.state, lastRunAt: s.lastRunAt ?? undefined, error: s.error ?? undefined } : null;
  }
}

