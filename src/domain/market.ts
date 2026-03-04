import Decimal from 'decimal.js';
import { MarketState, Outcome, MarketId, MarketType } from './types';

export type { MarketId };

/**
 * Market: binary prediction contract or index future
 * - BINARY: YES/NO outcome, price 0-1
 * - FUTURES: index-settled, BUY/SELL, price in index units
 */
export interface Market {
  id: MarketId;
  description: string;
  location: string;
  eventDate: Date;
  condition: string;
  state: MarketState;
  marketType?: MarketType;
  indexType?: string | null;
  indexId?: string | null;
  minPrice?: Decimal | null;
  maxPrice?: Decimal | null;
  correlationGroupId?: string | null;
  contractMultiplier?: Decimal | null;
  createdAt: Date;
  lockedAt: Date | null;
  resolvedAt: Date | null;
  settledAt: Date | null;
  winningOutcome: Outcome | null;
}

/**
 * Market lifecycle transitions
 */
export class MarketLifecycle {
  /**
   * Check if market can transition to new state
   * Enforces strict state machine rules
   */
  static canTransition(current: MarketState, next: MarketState): boolean {
    const validTransitions: Record<MarketState, MarketState[]> = {
      [MarketState.DRAFT]: [MarketState.OPEN],
      [MarketState.OPEN]: [MarketState.LOCKED],
      [MarketState.LOCKED]: [MarketState.RESOLVED],
      [MarketState.RESOLVED]: [MarketState.SETTLED],
      [MarketState.SETTLED]: [], // Terminal state
    };

    return validTransitions[current]?.includes(next) ?? false;
  }

  /**
   * Check if trading is allowed in current state
   */
  static isTradingAllowed(state: MarketState): boolean {
    return state === MarketState.OPEN;
  }

  /**
   * Check if market can be resolved
   */
  static canResolve(state: MarketState): boolean {
    return state === MarketState.LOCKED;
  }

  /**
   * Check if market can be settled
   */
  static canSettle(state: MarketState): boolean {
    return state === MarketState.RESOLVED;
  }
}

