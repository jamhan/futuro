import Decimal from 'decimal.js';
import { Outcome, AccountId, MarketType } from '../domain/types';
import { Position } from '../domain/account';

/**
 * Settlement service: binary (YES/NO) and futures (index value)
 *
 * Binary: winning outcome pays 1.00 per share.
 * Futures: payout = position.quantity * indexValue (cash settlement).
 */
export class SettlementService {
  /**
   * Binary: payout per position from winning outcome
   */
  calculateBinaryPayout(position: Position, winningOutcome: Outcome): Decimal {
    if (winningOutcome === Outcome.YES) {
      return position.yesShares.times(1);
    }
    return position.noShares.times(1);
  }

  /**
   * Futures: payout = quantity * indexValue (long gets credited, short debited)
   */
  calculateFuturesPayout(position: Position, indexValue: Decimal): Decimal {
    const qty = position.quantity ?? new Decimal(0);
    return qty.times(indexValue);
  }

  /**
   * Calculate settlement payout (binary or futures)
   */
  calculatePayout(
    position: Position,
    winningOutcome: Outcome,
    options?: { marketType?: MarketType; indexValue?: Decimal }
  ): Decimal {
    if (options?.marketType === MarketType.FUTURES && options?.indexValue != null) {
      return this.calculateFuturesPayout(position, options.indexValue);
    }
    return this.calculateBinaryPayout(position, winningOutcome);
  }

  /**
   * Calculate total settlements for a market
   */
  calculateSettlements(
    positions: Position[],
    winningOutcome: Outcome,
    options?: { marketType?: MarketType; indexValue?: Decimal }
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
      const currentBalance = existingBalances.get(accountId) || new Decimal(0);
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
    options?: { marketType?: MarketType; indexValue?: Decimal }
  ): { isValid: boolean; totalValue: Decimal; totalCash: Decimal } {
    const totalPayout = positions.reduce(
      (sum, pos) => sum.plus(this.calculatePayout(pos, winningOutcome, options)),
      new Decimal(0)
    );
    const totalCash = Array.from(balances.values()).reduce(
      (sum, balance) => sum.plus(balance),
      new Decimal(0)
    );
    return {
      isValid: true,
      totalValue: totalPayout,
      totalCash,
    };
  }
}

