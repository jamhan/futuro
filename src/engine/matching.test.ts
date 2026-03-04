import Decimal from 'decimal.js';
import { MatchingEngine, OrderBook } from './matching';
import { OrderSide, OrderType, OrderStatus } from '../domain/types';
import { Order, createOrder } from '../domain/order';

describe('MatchingEngine', () => {
  const marketId = 'market_1';

  function createTestOrder(
    side: OrderSide,
    price: number | null,
    quantity: number,
    accountId = 'account_1'
  ): Order {
    const input = {
      marketId,
      accountId,
      side,
      type: price !== null ? OrderType.LIMIT : OrderType.MARKET,
      price: price !== null ? new Decimal(price) : null,
      quantity: new Decimal(quantity),
    };
    return createOrder(input);
  }

  describe('price-time priority matching', () => {
    it('should match BUY_YES with BUY_NO at compatible prices', () => {
      const orderBook = new OrderBook();
      const buyNoOrder = createTestOrder(OrderSide.BUY_NO, 0.4, 10, 'account_2');
      orderBook.addOrder(buyNoOrder);

      const buyYesOrder = createTestOrder(OrderSide.BUY_YES, 0.6, 10, 'account_1');
      const result = MatchingEngine.matchOrder(buyYesOrder, orderBook, marketId);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity.toNumber()).toBe(10);
      expect(result.trades[0].price.toNumber()).toBe(0.4); // Resting order's price
      expect(result.filledOrderIds).toContain(buyNoOrder.id);
      expect(result.filledOrderIds).toContain(buyYesOrder.id);
    });

    it('should not match if prices are incompatible', () => {
      const orderBook = new OrderBook();
      const buyNoOrder = createTestOrder(OrderSide.BUY_NO, 0.5, 10, 'account_2');
      orderBook.addOrder(buyNoOrder);

      const buyYesOrder = createTestOrder(OrderSide.BUY_YES, 0.4, 10, 'account_1');
      // 0.4 + 0.5 = 0.9 < 1.0, so no match
      const result = MatchingEngine.matchOrder(buyYesOrder, orderBook, marketId);

      expect(result.trades).toHaveLength(0);
      expect(result.remainingOrder).not.toBeNull();
    });

    it('should match at resting order price (price-time priority)', () => {
      const orderBook = new OrderBook();
      const buyNoOrder = createTestOrder(OrderSide.BUY_NO, 0.4, 10, 'account_2');
      orderBook.addOrder(buyNoOrder);

      const buyYesOrder = createTestOrder(OrderSide.BUY_YES, 0.7, 10, 'account_1');
      const result = MatchingEngine.matchOrder(buyYesOrder, orderBook, marketId);

      expect(result.trades[0].price.toNumber()).toBe(0.4); // Resting order's price
    });

    it('should partially fill orders', () => {
      const orderBook = new OrderBook();
      const buyNoOrder = createTestOrder(OrderSide.BUY_NO, 0.4, 5, 'account_2');
      orderBook.addOrder(buyNoOrder);

      const buyYesOrder = createTestOrder(OrderSide.BUY_YES, 0.6, 10, 'account_1');
      const result = MatchingEngine.matchOrder(buyYesOrder, orderBook, marketId);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity.toNumber()).toBe(5);
      expect(result.remainingOrder).not.toBeNull();
      expect(result.remainingOrder?.filledQuantity.toNumber()).toBe(5);
      expect(result.remainingOrder?.status).toBe(OrderStatus.PARTIALLY_FILLED);
    });

    it('should match multiple orders in sequence', () => {
      const orderBook = new OrderBook();
      const buyNoOrder1 = createTestOrder(OrderSide.BUY_NO, 0.4, 5, 'account_2');
      const buyNoOrder2 = createTestOrder(OrderSide.BUY_NO, 0.45, 5, 'account_3');
      orderBook.addOrder(buyNoOrder1);
      orderBook.addOrder(buyNoOrder2);

      const buyYesOrder = createTestOrder(OrderSide.BUY_YES, 0.6, 10, 'account_1');
      const result = MatchingEngine.matchOrder(buyYesOrder, orderBook, marketId);

      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].price.toNumber()).toBe(0.4); // Best price first
      expect(result.trades[1].price.toNumber()).toBe(0.45);
      expect(result.filledOrderIds).toContain(buyNoOrder1.id);
      expect(result.filledOrderIds).toContain(buyNoOrder2.id);
    });

    it('should handle market orders', () => {
      const orderBook = new OrderBook();
      const buyNoOrder = createTestOrder(OrderSide.BUY_NO, 0.4, 10, 'account_2');
      orderBook.addOrder(buyNoOrder);

      const marketOrder = createTestOrder(OrderSide.BUY_YES, null, 10, 'account_1');
      const result = MatchingEngine.matchOrder(marketOrder, orderBook, marketId);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price.toNumber()).toBe(0.4); // Uses counterparty's price
    });
  });

  describe('OrderBook', () => {
    it('should sort orders by price-time priority', () => {
      const orderBook = new OrderBook();
      
      const order1 = createTestOrder(OrderSide.BUY_YES, 0.6, 10, 'account_1');
      order1.createdAt = new Date(1000);
      const order2 = createTestOrder(OrderSide.BUY_YES, 0.7, 10, 'account_2');
      order2.createdAt = new Date(2000);
      const order3 = createTestOrder(OrderSide.BUY_YES, 0.6, 10, 'account_3');
      order3.createdAt = new Date(500);

      orderBook.addOrder(order1);
      orderBook.addOrder(order2);
      orderBook.addOrder(order3);

      const yesOrders = orderBook.getYesOrders();
      expect(yesOrders[0].id).toBe(order2.id); // Highest price first
      expect(yesOrders[1].id).toBe(order3.id); // Same price, older first
      expect(yesOrders[2].id).toBe(order1.id);
    });
  });
});

