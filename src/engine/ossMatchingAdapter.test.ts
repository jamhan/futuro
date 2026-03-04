import Decimal from 'decimal.js';
import { matchOrderWithOss } from './ossMatchingAdapter';
import { Order, createOrder } from '../domain/order';
import { OrderSide, OrderType } from '../domain/types';

const MARKET_ID = 'market_futures_1';

function createOrderWithSide(
  side: OrderSide,
  price: number,
  quantity: number,
  accountId: string
): Order {
  return createOrder({
    marketId: MARKET_ID,
    accountId,
    side,
    type: OrderType.LIMIT,
    price: new Decimal(price),
    quantity: new Decimal(quantity),
  });
}

function createMarketOrder(side: OrderSide, quantity: number, accountId: string): Order {
  return createOrder({
    marketId: MARKET_ID,
    accountId,
    side,
    type: OrderType.MARKET,
    price: null,
    quantity: new Decimal(quantity),
  });
}

describe('OSS matching adapter (nodejs-order-book)', () => {
  describe('side normalization (BUY_YES/BUY_NO must map to correct book side)', () => {
    /**
     * REGRESSION: Previously BUY_YES was mapped to 'sell', so a resting "buy"
     * order was placed on the ask side and would never match an incoming sell.
     * Resting BUY_YES must rehydrate as BID so that incoming SELL can match it.
     */
    it('resting BUY_YES rehydrates as bid and matches incoming SELL', () => {
      const restingBuyYes = createOrderWithSide(OrderSide.BUY_YES, 25, 10, 'account_rest');
      const incomingSell = createOrderWithSide(OrderSide.SELL, 25, 10, 'account_incoming');

      const result = matchOrderWithOss(incomingSell, [restingBuyYes], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity.toNumber()).toBe(10);
      expect(result.trades[0].price.toNumber()).toBe(25);
      expect(result.trades[0].buyerSide).toBe(OrderSide.BUY);
      expect(result.filledOrderIds).toContain(restingBuyYes.id);
      expect(result.filledOrderIds).toContain(incomingSell.id);
      expect(result.updatedCounterpartyOrders).toHaveLength(1);
    });

    /**
     * REGRESSION: Resting BUY_NO must rehydrate as ASK so that incoming BUY matches it.
     */
    it('resting BUY_NO rehydrates as ask and matches incoming BUY', () => {
      const restingBuyNo = createOrderWithSide(OrderSide.BUY_NO, 30, 10, 'account_rest');
      const incomingBuy = createOrderWithSide(OrderSide.BUY, 30, 10, 'account_incoming');

      const result = matchOrderWithOss(incomingBuy, [restingBuyNo], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity.toNumber()).toBe(10);
      expect(result.trades[0].price.toNumber()).toBe(30);
      expect(result.trades[0].buyerSide).toBe(OrderSide.BUY);
      expect(result.filledOrderIds).toContain(restingBuyNo.id);
      expect(result.filledOrderIds).toContain(incomingBuy.id);
    });

    it('resting BUY (futures) matches incoming SELL', () => {
      const resting = createOrderWithSide(OrderSide.BUY, 20, 5, 'acc_bid');
      const incoming = createOrderWithSide(OrderSide.SELL, 20, 5, 'acc_ask');

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price.toNumber()).toBe(20);
      expect(result.trades[0].quantity.toNumber()).toBe(5);
    });

    it('resting SELL (futures) matches incoming BUY', () => {
      const resting = createOrderWithSide(OrderSide.SELL, 15, 8, 'acc_ask');
      const incoming = createOrderWithSide(OrderSide.BUY, 15, 8, 'acc_bid');

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price.toNumber()).toBe(15);
      expect(result.trades[0].quantity.toNumber()).toBe(8);
    });

    it('rejects invalid order side with clear error', () => {
      const badOrder = createOrderWithSide(OrderSide.BUY_YES, 1, 1, 'acc');
      (badOrder as any).side = 'INVALID_SIDE';
      const resting = createOrderWithSide(OrderSide.SELL, 1, 1, 'rest');

      expect(() => matchOrderWithOss(badOrder, [resting], MARKET_ID)).toThrow(
        /unsupported order side.*INVALID_SIDE/
      );
    });
  });

  describe('price and quantity behavior', () => {
    it('does not match when prices do not cross (buy below ask)', () => {
      const restingAsk = createOrderWithSide(OrderSide.SELL, 100, 10, 'acc_ask');
      const incomingBuy = createOrderWithSide(OrderSide.BUY, 90, 10, 'acc_bid'); // 90 < 100

      const result = matchOrderWithOss(incomingBuy, [restingAsk], MARKET_ID);

      expect(result.trades).toHaveLength(0);
      expect(result.remainingOrder).not.toBeNull();
      expect(result.remainingOrder?.quantity.toNumber()).toBe(10);
    });

    it('does not match when prices do not cross (sell above bid)', () => {
      const restingBid = createOrderWithSide(OrderSide.BUY, 50, 10, 'acc_bid');
      const incomingSell = createOrderWithSide(OrderSide.SELL, 60, 10, 'acc_ask'); // 60 > 50

      const result = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

      expect(result.trades).toHaveLength(0);
    });

    it('matches at resting order price (taker crosses spread)', () => {
      const resting = createOrderWithSide(OrderSide.SELL, 25, 10, 'maker');
      const incoming = createOrderWithSide(OrderSide.BUY, 30, 10, 'taker'); // willing to pay 30

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price.toNumber()).toBe(25); // maker's price
    });

    it('partial fill: incoming buy 10 vs resting sell 4', () => {
      const resting = createOrderWithSide(OrderSide.SELL, 20, 4, 'maker');
      const incoming = createOrderWithSide(OrderSide.BUY, 20, 10, 'taker');

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity.toNumber()).toBe(4);
      expect(result.filledOrderIds).toContain(resting.id);
      expect(result.remainingOrder).not.toBeNull();
      expect(result.remainingOrder?.filledQuantity.toNumber()).toBe(4);
      expect(result.remainingOrder?.quantity.toNumber()).toBe(10);
    });

    /**
     * REGRESSION: Sell 3 lots, 2 match against resting buy 2 → remaining 1 lot must stay on book.
     * That 1 lot (as a resting ask) must match a subsequent buy 1. If the remaining order
     * is lost or has wrong state, the second match would fail or the third lot would "disappear".
     */
    it('partial fill SELL 3 vs resting BUY 2: remaining 1 lot stays on book and matches next BUY 1', () => {
      const restingBid = createOrderWithSide(OrderSide.BUY, 25, 2, 'bidder');
      const incomingSell = createOrderWithSide(OrderSide.SELL, 25, 3, 'seller');

      const result1 = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

      expect(result1.trades).toHaveLength(1);
      expect(result1.trades[0].quantity.toNumber()).toBe(2);
      expect(result1.remainingOrder).not.toBeNull();
      expect(result1.remainingOrder!.quantity.toNumber()).toBe(3);
      expect(result1.remainingOrder!.filledQuantity.toNumber()).toBe(2);
      const remainingAsk = result1.remainingOrder!;

      // Use the remaining order as the only resting order (simulates it being persisted and reloaded).
      const incomingBuy1 = createOrderWithSide(OrderSide.BUY, 25, 1, 'buyer2');
      const result2 = matchOrderWithOss(incomingBuy1, [remainingAsk], MARKET_ID);

      expect(result2.trades).toHaveLength(1);
      expect(result2.trades[0].quantity.toNumber()).toBe(1);
      expect(result2.trades[0].price.toNumber()).toBe(25);
      expect(result2.filledOrderIds).toContain(remainingAsk.id);
    });

    it('multiple resting orders: fills at best ask first (price-time)', () => {
      const ask1 = createOrderWithSide(OrderSide.SELL, 25, 5, 'ask1');
      const ask2 = createOrderWithSide(OrderSide.SELL, 30, 5, 'ask2');
      const incoming = createOrderWithSide(OrderSide.BUY, 30, 10, 'bid');

      const result = matchOrderWithOss(incoming, [ask1, ask2], MARKET_ID);

      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].price.toNumber()).toBe(25);
      expect(result.trades[0].quantity.toNumber()).toBe(5);
      expect(result.trades[1].price.toNumber()).toBe(30);
      expect(result.trades[1].quantity.toNumber()).toBe(5);
      expect(result.filledOrderIds).toContain(ask1.id);
      expect(result.filledOrderIds).toContain(ask2.id);
    });
  });

  describe('market orders', () => {
    it('market BUY matches resting SELL at ask price', () => {
      const resting = createOrderWithSide(OrderSide.SELL, 42, 10, 'maker');
      const incoming = createMarketOrder(OrderSide.BUY, 10, 'taker');

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price.toNumber()).toBe(42);
      expect(result.trades[0].quantity.toNumber()).toBe(10);
    });

    it('market SELL matches resting BUY at bid price', () => {
      const resting = createOrderWithSide(OrderSide.BUY, 18, 7, 'maker');
      const incoming = createMarketOrder(OrderSide.SELL, 7, 'taker');

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price.toNumber()).toBe(18);
    });
  });

  describe('empty book and edge cases', () => {
    it('incoming limit order with no resting orders leaves resting order', () => {
      const incoming = createOrderWithSide(OrderSide.BUY, 50, 10, 'acc');

      const result = matchOrderWithOss(incoming, [], MARKET_ID);

      expect(result.trades).toHaveLength(0);
      expect(result.remainingOrder).not.toBeNull();
      expect(result.remainingOrder?.id).toBe(incoming.id);
      expect(result.remainingOrder?.status).toBe('PENDING');
    });

    it('skips resting orders with zero remaining quantity', () => {
      const filledOrder = createOrderWithSide(OrderSide.SELL, 10, 5, 'acc');
      filledOrder.filledQuantity = new Decimal(5);
      filledOrder.status = 'FILLED' as any;
      const incoming = createOrderWithSide(OrderSide.BUY, 10, 5, 'bid');

      const result = matchOrderWithOss(incoming, [filledOrder], MARKET_ID);

      expect(result.trades).toHaveLength(0);
      expect(result.remainingOrder).not.toBeNull();
    });

    it('skips resting orders with invalid price (0)', () => {
      const resting = createOrderWithSide(OrderSide.SELL, 1, 5, 'acc');
      resting.price = new Decimal(0);
      const incoming = createOrderWithSide(OrderSide.BUY, 1, 5, 'bid');

      const result = matchOrderWithOss(incoming, [resting], MARKET_ID);

      expect(result.trades).toHaveLength(0);
    });
  });

  describe('trade attribution (buyer vs seller)', () => {
    it('trade records BUY side as buyer and SELL side as seller', () => {
      const restingSell = createOrderWithSide(OrderSide.SELL, 33, 6, 'seller_account');
      const incomingBuy = createOrderWithSide(OrderSide.BUY, 33, 6, 'buyer_account');

      const result = matchOrderWithOss(incomingBuy, [restingSell], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      const t = result.trades[0];
      expect(t.buyOrderId).toBe(incomingBuy.id);
      expect(t.sellOrderId).toBe(restingSell.id);
      expect(t.buyerAccountId).toBe('buyer_account');
      expect(t.sellerAccountId).toBe('seller_account');
      expect(t.buyerSide).toBe(OrderSide.BUY);
    });
  });
});
