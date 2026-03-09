/**
 * In-memory order book manager. Holds per-market order books to avoid DB round-trip on every order.
 * Lazy loads from DB on first access; syncs in-memory state after each place/cancel.
 */

import { OrderRepository } from '../repositories/orderRepository';
import { OrderBook } from '../engine/matching';
import { Order, OrderValidator } from '../domain/order';
import { OrderStatus } from '../domain/types';
import type { MatchingResult } from '../engine/matching';

export class OrderBookManager {
  private orderRepo: OrderRepository;
  private binaryBooks = new Map<string, OrderBook>();
  private futuresBooks = new Map<string, Order[]>();

  constructor(orderRepo?: OrderRepository) {
    this.orderRepo = orderRepo ?? new OrderRepository();
  }

  /**
   * Get order book for binary market. Lazy loads from DB if not in memory.
   */
  async getBookForBinary(marketId: string): Promise<OrderBook> {
    let book = this.binaryBooks.get(marketId);
    if (!book) {
      const orders = await this.getActiveOrdersForMarket(marketId);
      book = new OrderBook();
      for (const order of orders) {
        book.addOrder(order);
      }
      this.binaryBooks.set(marketId, book);
    }
    return book;
  }

  /**
   * Get resting orders for futures market. Lazy loads from DB if not in memory.
   */
  async getRestingOrdersForFutures(marketId: string): Promise<Order[]> {
    let orders = this.futuresBooks.get(marketId);
    if (!orders) {
      orders = await this.getActiveOrdersForMarket(marketId);
      this.futuresBooks.set(marketId, orders);
    }
    return orders;
  }

  /**
   * Update in-memory state after order placement. Call after transaction commits.
   */
  onOrderPlaced(
    marketId: string,
    result: MatchingResult,
    isFutures: boolean
  ): void {
    if (isFutures) {
      this.onOrderPlacedFutures(marketId, result);
    } else {
      this.onOrderPlacedBinary(marketId, result);
    }
  }

  private onOrderPlacedBinary(marketId: string, result: MatchingResult): void {
    const book = this.binaryBooks.get(marketId);
    if (!book) return; // Not in memory (e.g. first order for market - book was built fresh in ExchangeService, not from us)

    // MatchingEngine already mutated the book (removed filled counterparties). Add remaining order.
    if (result.remainingOrder) {
      book.addOrder(result.remainingOrder);
    }
  }

  private onOrderPlacedFutures(marketId: string, result: MatchingResult): void {
    let orders = this.futuresBooks.get(marketId);
    if (!orders) return;

    const filledIds = new Set(result.filledOrderIds);
    const updatedById = new Map(
      result.updatedCounterpartyOrders.map((o) => [o.id, o])
    );

    // Remove filled orders, apply counterparty updates, add remaining
    orders = orders.filter((o) => !filledIds.has(o.id));
    orders = orders.map((o) => updatedById.get(o.id) ?? o);
    if (result.remainingOrder) {
      orders.push(result.remainingOrder);
    }
    this.futuresBooks.set(marketId, orders);
  }

  /**
   * Remove order from in-memory book after cancel. Call after DB update.
   */
  onOrderCancelled(marketId: string, orderId: string, isFutures: boolean): void {
    if (isFutures) {
      const orders = this.futuresBooks.get(marketId);
      if (orders) {
        this.futuresBooks.set(
          marketId,
          orders.filter((o) => o.id !== orderId)
        );
      }
    } else {
      const book = this.binaryBooks.get(marketId);
      if (book) {
        book.removeOrder(orderId);
      }
    }
  }

  private async getActiveOrdersForMarket(marketId: string): Promise<Order[]> {
    const pendingOrders = await this.orderRepo.findByMarket(marketId, OrderStatus.PENDING);
    const partiallyFilledOrders = await this.orderRepo.findByMarket(
      marketId,
      OrderStatus.PARTIALLY_FILLED
    );
    return [...pendingOrders, ...partiallyFilledOrders].filter((order) => {
      const remaining = OrderValidator.remainingQuantity(order);
      return remaining.gt(0);
    });
  }
}

let defaultInstance: OrderBookManager | null = null;

export function getOrderBookManager(): OrderBookManager {
  if (!defaultInstance) {
    defaultInstance = new OrderBookManager();
  }
  return defaultInstance;
}
