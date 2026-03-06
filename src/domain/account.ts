import Decimal from 'decimal.js';
import { AccountId } from './types';

export type { AccountId };

/**
 * Account represents a user's balance and positions
 * 
 * In a zero-sum exchange:
 * - Cash balance can be positive or negative (margin)
 * - Positions are tracked per market
 */
export interface Account {
  id: AccountId;
  balance: Decimal; // Cash balance
  isPaper?: boolean; // True for agent (paper trading) accounts
  createdAt: Date;
}

/**
 * Position represents holdings in a specific market
 * - Binary: yesShares, noShares
 * - Futures: quantity (net contracts, positive=long, negative=short)
 */
export interface Position {
  accountId: AccountId;
  marketId: string;
  yesShares: Decimal;
  noShares: Decimal;
  quantity?: Decimal | null; // Net contracts for FUTURES markets
}

/**
 * Account operations
 */
export class AccountOperations {
  /**
   * Calculate net position value at current prices
   * This is for display purposes only - settlement uses fixed payouts
   */
  static calculatePositionValue(
    position: Position,
    yesPrice: Decimal,
    noPrice: Decimal
  ): Decimal {
    const yesValue = position.yesShares.times(yesPrice);
    const noValue = position.noShares.times(noPrice);
    return yesValue.plus(noValue);
  }

  /**
   * Check if account has sufficient balance for a trade
   * In a zero-sum system, we need to check:
   * - Buyer pays price * quantity
   * - Seller receives price * quantity
   */
  static canAffordTrade(
    accountBalance: Decimal,
    side: 'buy' | 'sell',
    price: Decimal,
    quantity: Decimal
  ): boolean {
    if (side === 'buy') {
      const cost = price.times(quantity);
      return accountBalance.gte(cost);
    }
    // Seller doesn't need balance check (they're receiving funds)
    return true;
  }
}

