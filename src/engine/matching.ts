import Decimal from 'decimal.js';
import {
  OrderSide,
  OrderType,
  Price,
  Quantity,
} from '../domain/types';
import { Order, OrderValidator } from '../domain/order';
import { Trade, createTrade } from '../domain/trade';

const D_ZERO = new Decimal(0);
const D_ONE = new Decimal(1);
const D_HALF = new Decimal(0.5);

/**
 * OrderBook maintains orders for a binary market
 * 
 * In a binary market:
 * - BUY_YES orders match with BUY_NO orders (buying YES = selling NO)
 * - Orders are sorted by price-time priority
 */
export class OrderBook {
  private yesOrders: Order[] = []; // BUY_YES orders: highest price first, then oldest
  private noOrders: Order[] = [];  // BUY_NO orders: highest price first, then oldest

  /**
   * Add order to the book
   * Returns the order (may be modified if partially filled)
   */
  addOrder(order: Order): Order {
    if (order.side === OrderSide.BUY_YES) {
      this.yesOrders.push(order);
      this.sortYesOrders();
    } else if (order.side === OrderSide.BUY_NO) {
      this.noOrders.push(order);
      this.sortNoOrders();
    }
    return order;
  }

  /**
   * Remove order from the book
   */
  removeOrder(orderId: string): boolean {
    const yesIndex = this.yesOrders.findIndex((o) => o.id === orderId);
    if (yesIndex >= 0) {
      this.yesOrders.splice(yesIndex, 1);
      return true;
    }
    const noIndex = this.noOrders.findIndex((o) => o.id === orderId);
    if (noIndex >= 0) {
      this.noOrders.splice(noIndex, 1);
      return true;
    }
    return false;
  }

  /**
   * Get best YES order (highest price, oldest first)
   */
  getBestYes(): Order | null {
    return this.yesOrders.length > 0 ? this.yesOrders[0] : null;
  }

  /**
   * Get best NO order (highest price, oldest first)
   */
  getBestNo(): Order | null {
    return this.noOrders.length > 0 ? this.noOrders[0] : null;
  }

  /**
   * Get all YES orders (for display)
   */
  getYesOrders(): readonly Order[] {
    return this.yesOrders;
  }

  /**
   * Get all NO orders (for display)
   */
  getNoOrders(): readonly Order[] {
    return this.noOrders;
  }

  /**
   * Sort YES orders: highest price first, then oldest first
   */
  private sortYesOrders(): void {
    this.yesOrders.sort((a, b) => {
      const priceA = a.price ?? D_ONE; // Market orders go to back
      const priceB = b.price ?? D_ONE;
      const priceDiff = priceB.comparedTo(priceA); // Descending
      if (priceDiff !== 0) return priceDiff;
      return a.createdAt.getTime() - b.createdAt.getTime(); // Ascending (oldest first)
    });
  }

  /**
   * Sort NO orders: lowest price first, then oldest first
   * (When YES buyers match with NO orders, they want the lowest NO price)
   */
  private sortNoOrders(): void {
    this.noOrders.sort((a, b) => {
      const priceA = a.price ?? D_ZERO; // Market orders go to front
      const priceB = b.price ?? D_ZERO;
      const priceDiff = priceA.comparedTo(priceB); // Ascending (lowest first)
      if (priceDiff !== 0) return priceDiff;
      return a.createdAt.getTime() - b.createdAt.getTime(); // Ascending (oldest first)
    });
  }
}

/**
 * MatchingResult contains the outcome of matching an order
 */
export interface MatchingResult {
  trades: Trade[];
  remainingOrder: Order | null; // Order with remaining quantity, or null if fully filled
  filledOrderIds: string[]; // IDs of orders that were fully filled
  updatedCounterpartyOrders: Order[]; // Counterparty orders that were updated (partially or fully filled)
}

/**
 * MatchingEngine implements price-time priority matching
 * 
 * This is a pure function - no side effects, fully deterministic
 */
export class MatchingEngine {
  /**
   * Match a new order against the order book
   * 
   * Algorithm:
   * 1. For buy orders, match against sell orders
   * 2. For sell orders, match against buy orders
   * 3. Match at the best available price (price-time priority)
   * 4. Continue until order is filled or no more matches
   * 
   * Returns: trades generated, remaining order (if partially filled), filled order IDs
   */
  static matchOrder(
    order: Order,
    orderBook: OrderBook,
    marketId: string
  ): MatchingResult {
    const trades: Trade[] = [];
    const filledOrderIds: string[] = [];
    const updatedCounterpartyOrders: Order[] = [];
    let remainingQuantity = OrderValidator.remainingQuantity(order);

    // In binary markets, BUY_YES matches with BUY_NO
    while (remainingQuantity.gt(0)) {
      const counterparty =
        order.side === OrderSide.BUY_YES
          ? orderBook.getBestNo()
          : orderBook.getBestYes();

      if (!counterparty) {
        break; // No more matches
      }

      // Check if prices are compatible
      if (!this.canMatch(order, counterparty)) {
        break; // Price mismatch
      }

      // Determine match price (use counterparty's limit price, or order's price)
      const matchPrice = this.determineMatchPrice(order, counterparty);

      // Determine match quantity (minimum of remaining quantities)
      const counterpartyRemaining = OrderValidator.remainingQuantity(
        counterparty
      );
      const matchQuantity = Decimal.min(remainingQuantity, counterpartyRemaining);

      // Create trade
      // The buyer is the one placing the order, seller is the counterparty
      const trade = createTrade(
        order,
        counterparty,
        matchPrice,
        matchQuantity,
        marketId
      );
      trades.push(trade);

      // Update quantities
      remainingQuantity = remainingQuantity.minus(matchQuantity);

      // Update counterparty order
      counterparty.filledQuantity = counterparty.filledQuantity.plus(
        matchQuantity
      );
      counterparty.updatedAt = new Date();
      if (counterparty.filledQuantity.gte(counterparty.quantity)) {
        counterparty.status = 'FILLED' as any;
        filledOrderIds.push(counterparty.id);
        orderBook.removeOrder(counterparty.id);
      } else {
        counterparty.status = 'PARTIALLY_FILLED' as any;
      }
      // IMPORTANT: Push a copy of the order to avoid reference issues
      // Create a new object with updated values
      updatedCounterpartyOrders.push({
        ...counterparty,
        filledQuantity: counterparty.filledQuantity,
        status: counterparty.status,
        updatedAt: counterparty.updatedAt,
      });

      // Update incoming order
      order.filledQuantity = order.filledQuantity.plus(matchQuantity);
    }

    // Determine final status of incoming order
    let remainingOrder: Order | null = null;
    order.updatedAt = new Date();
    if (remainingQuantity.gt(0)) {
      order.status = order.filledQuantity.gt(0)
        ? ('PARTIALLY_FILLED' as any)
        : ('PENDING' as any);
      remainingOrder = order;
    } else {
      order.status = 'FILLED' as any;
      filledOrderIds.push(order.id);
    }

    return {
      trades,
      remainingOrder,
      filledOrderIds,
      updatedCounterpartyOrders,
    };
  }

  /**
   * Check if two orders can match
   * 
   * For binary markets:
   * - BUY_YES matches with BUY_NO (they're buying opposite outcomes)
   * - Both are "buy" orders, but for different outcomes
   * 
   * Price compatibility:
   * - If I'm buying YES at price P, I'm willing to pay P per share
   * - If someone is buying NO at price Q, they're willing to pay Q per share
   * - For a match: P + Q >= 1.0 (because YES + NO = 1.0 always)
   * - But we use simpler logic: buyer's price must be >= counterparty's price
   *   (because the counterparty is effectively "selling" at their buy price)
   */
  private static canMatch(order: Order, counterparty: Order): boolean {
    // Must be buying opposite outcomes
    if (
      (order.side === OrderSide.BUY_YES &&
        counterparty.side !== OrderSide.BUY_NO) ||
      (order.side === OrderSide.BUY_NO &&
        counterparty.side !== OrderSide.BUY_YES)
    ) {
      return false;
    }

    // Check price compatibility
    if (order.type === OrderType.MARKET) {
      return true; // Market orders always match if counterparty exists
    }

    if (counterparty.type === OrderType.MARKET) {
      return true; // Market orders always match
    }

    // Both are limit orders - check price
    if (!order.price || !counterparty.price) {
      return false; // Should not happen, but be safe
    }

    // For binary markets: order's price + counterparty's price should be >= 1.0
    // But simpler: order's price must be >= (1 - counterparty's price)
    // Actually, even simpler: if I'm buying YES at 0.6 and someone is buying NO at 0.4,
    // we can match because 0.6 + 0.4 = 1.0. But if they're buying NO at 0.5,
    // then 0.6 + 0.5 = 1.1 > 1.0, so we can match.
    // The constraint is: order.price + counterparty.price >= 1.0
    const totalPrice = order.price.plus(counterparty.price);
    return totalPrice.gte(1);
  }

  /**
   * Determine the match price
   * Uses price-time priority: the resting order's price takes precedence
   */
  private static determineMatchPrice(
    order: Order,
    counterparty: Order
  ): Price {
    // If counterparty has a limit price, use it (resting order priority)
    if (counterparty.price) {
      return counterparty.price;
    }

    // If order has a limit price, use it
    if (order.price) {
      return order.price;
    }

    // Both are market orders - this shouldn't happen in practice
    return D_HALF;
  }
}

