import Decimal from 'decimal.js';
import { matchOrderWithOss } from './ossMatchingAdapter';
import { createOrder } from '../domain/order';
import { OrderSide, OrderType } from '../domain/types';

const MARKET_ID = 'market_1';

/**
 * Build an order for testing (futures: BUY/SELL, price in index units).
 */
function order(side: OrderSide, price: number, quantity: number, accountId: string) {
  return createOrder({
    marketId: MARKET_ID,
    accountId,
    side,
    type: OrderType.LIMIT,
    price: new Decimal(price),
    quantity: new Decimal(quantity),
  });
}

describe('Exchange flow (matching + persistence shape)', () => {
  /**
   * When you SELL more than the bid size, the remaining order must stay on the book
   * at YOUR price (the incoming sell price), not the counterparty's price.
   */
  it('remaining order after partial fill keeps incoming order price and side', () => {
    const restingBid = order(OrderSide.BUY, 20, 2, 'bidder');
    const incomingSell = order(OrderSide.SELL, 5, 5, 'seller');

    const result = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].price.toNumber()).toBe(20);
    expect(result.trades[0].quantity.toNumber()).toBe(2);
    expect(result.remainingOrder).not.toBeNull();
    expect(result.remainingOrder!.side).toBe(OrderSide.SELL);
    expect(result.remainingOrder!.price?.toNumber()).toBe(5);
    expect(result.remainingOrder!.quantity.toNumber()).toBe(5);
    expect(result.remainingOrder!.filledQuantity.toNumber()).toBe(2);
  });

  /**
   * Counterparty in the trade must be the resting order (the one that was in the book),
   * not the incoming order. So when incoming is SELL, buyer = resting BUY, seller = incoming SELL.
   */
  it('trade attributes buyer and seller correctly when incoming is SELL', () => {
    const restingBid = order(OrderSide.BUY, 20, 2, 'bidder');
    const incomingSell = order(OrderSide.SELL, 5, 5, 'seller');

    const result = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

    expect(result.trades[0].buyOrderId).toBe(restingBid.id);
    expect(result.trades[0].sellOrderId).toBe(incomingSell.id);
    expect(result.trades[0].buyerAccountId).toBe('bidder');
    expect(result.trades[0].sellerAccountId).toBe('seller');
  });

  /**
   * When incoming is BUY and partially fills, remaining order is BUY at incoming price.
   */
  it('remaining order after partial fill (incoming BUY) keeps BUY side and price', () => {
    const restingAsk = order(OrderSide.SELL, 10, 3, 'seller');
    const incomingBuy = order(OrderSide.BUY, 15, 10, 'buyer');

    const result = matchOrderWithOss(incomingBuy, [restingAsk], MARKET_ID);

    expect(result.trades).toHaveLength(1);
    expect(result.remainingOrder).not.toBeNull();
    expect(result.remainingOrder!.side).toBe(OrderSide.BUY);
    expect(result.remainingOrder!.price?.toNumber()).toBe(15);
    expect(result.remainingOrder!.quantity.toNumber()).toBe(10);
    expect(result.remainingOrder!.filledQuantity.toNumber()).toBe(3);
  });

  /**
   * Full fill: no remaining order, incoming order id appears in filledOrderIds.
   */
  it('full fill leaves no remaining order and marks incoming as filled', () => {
    const restingBid = order(OrderSide.BUY, 25, 10, 'bidder');
    const incomingSell = order(OrderSide.SELL, 25, 10, 'seller');

    const result = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

    expect(result.trades).toHaveLength(1);
    expect(result.remainingOrder).toBeNull();
    expect(result.filledOrderIds).toContain(incomingSell.id);
    expect(result.filledOrderIds).toContain(restingBid.id);
  });

  /**
   * Multiple counterparties: two resting sells, incoming buy fills both. Two trades.
   */
  it('incoming buy matches multiple resting sells in price order', () => {
    const ask1 = order(OrderSide.SELL, 10, 2, 's1');
    const ask2 = order(OrderSide.SELL, 15, 3, 's2');
    const incomingBuy = order(OrderSide.BUY, 20, 10, 'buyer');

    const result = matchOrderWithOss(incomingBuy, [ask1, ask2], MARKET_ID);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].price.toNumber()).toBe(10);
    expect(result.trades[0].quantity.toNumber()).toBe(2);
    expect(result.trades[1].price.toNumber()).toBe(15);
    expect(result.trades[1].quantity.toNumber()).toBe(3);
    expect(result.remainingOrder).not.toBeNull();
    expect(result.remainingOrder!.filledQuantity.toNumber()).toBe(5);
  });
});
