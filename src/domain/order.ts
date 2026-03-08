import Decimal from 'decimal.js';
import {
  OrderId,
  MarketId,
  AccountId,
  OrderType,
  OrderSide,
  OrderStatus,
  Price,
  Quantity,
} from './types';

export type { OrderId, MarketId, AccountId };

/**
 * Order represents a trading intent
 * 
 * Price-time priority: Orders are matched by price first, then by time
 */
export interface Order {
  id: OrderId;
  marketId: MarketId;
  accountId: AccountId;
  side: OrderSide;
  type: OrderType;
  price: Price | null; // null for market orders
  quantity: Quantity;
  filledQuantity: Quantity;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reason for trade - required when agent places order.
 * Ensures agents document their reasoning and methodology.
 *
 * - reason: Short summary of why you are placing this order.
 * - theoreticalPriceMethod: Methods/models used to decide (e.g. "BOM ensemble mean", "order book mid").
 * - confidenceInterval: 90% CI on the instrument's settlement price. BINARY: [lower, upper] in 0-1 (probability).
 *   FUTURES: index units, e.g. [8, 12] for mm rainfall.
 */
export interface ReasonForTrade {
  confidenceInterval?: [number, number];
  reason: string;
  theoreticalPriceMethod: string;
}

/**
 * Order creation input (before persistence)
 */
export interface OrderInput {
  marketId: MarketId;
  accountId: AccountId;
  side: OrderSide;
  type: OrderType;
  price: Price | null;
  quantity: Quantity;
  reasonForTrade?: ReasonForTrade;
}

/**
 * Order validation and invariants
 */
export class OrderValidator {
  /**
   * Validate order input
   * Returns array of error messages, empty if valid
   */
  static validate(order: OrderInput): string[] {
    const errors: string[] = [];

    if (order.quantity.lte(0)) {
      errors.push('Quantity must be positive');
    }

    if (order.type === OrderType.LIMIT) {
      if (!order.price) {
        errors.push('Limit orders must have a price');
      } else if (order.price.lte(0)) {
        errors.push('Price must be positive');
      } else if (
        order.side !== OrderSide.BUY &&
        order.side !== OrderSide.SELL &&
        order.price.gt(1)
      ) {
        errors.push('Binary market price must be between 0.00 and 1.00');
      }
    }

    if (order.type === OrderType.MARKET && order.price !== null) {
      errors.push('Market orders must not have a price');
    }

    return errors;
  }

  /**
   * Check if order can be cancelled
   */
  static canCancel(order: Order): boolean {
    return (
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.PARTIALLY_FILLED
    );
  }

  /**
   * Calculate remaining quantity to fill
   */
  static remainingQuantity(order: Order): Quantity {
    return order.quantity.minus(order.filledQuantity);
  }
}

/**
 * Create a new order from input
 */
export function createOrder(input: OrderInput): Order {
  const now = new Date();
  return {
    id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    marketId: input.marketId,
    accountId: input.accountId,
    side: input.side,
    type: input.type,
    price: input.price,
    quantity: input.quantity,
    filledQuantity: new Decimal(0),
    status: OrderStatus.PENDING,
    createdAt: now,
    updatedAt: now,
  };
}

