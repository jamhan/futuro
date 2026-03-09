import Decimal from 'decimal.js';
import { OrderBookManager } from './orderBookManager';
import { OrderBook } from '../engine/matching';
import { MatchingEngine } from '../engine/matching';
import { createOrder } from '../domain/order';
import { OrderSide, OrderType } from '../domain/types';

const MARKET_ID = 'market-1';

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

describe('OrderBookManager', () => {
  describe('getBookForBinary', () => {
    it('lazy loads empty book when no resting orders', async () => {
      const mockRepo = {
        findByMarket: jest.fn().mockResolvedValue([]),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      const book = await mgr.getBookForBinary(MARKET_ID);
      expect(book).toBeInstanceOf(OrderBook);
      expect(mockRepo.findByMarket).toHaveBeenCalledWith(MARKET_ID, 'PENDING');
      expect(mockRepo.findByMarket).toHaveBeenCalledWith(MARKET_ID, 'PARTIALLY_FILLED');
    });

    it('lazy loads and populates book from resting orders', async () => {
      const restingYes = order(OrderSide.BUY_YES, 0.6, 10, 'a1');
      const restingNo = order(OrderSide.BUY_NO, 0.4, 10, 'a2');
      const allResting = [restingYes, restingNo];
      const mockRepo = {
        findByMarket: jest.fn((_marketId: string, status: string) =>
          Promise.resolve(status === 'PENDING' ? allResting : [])
        ),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      const book = await mgr.getBookForBinary(MARKET_ID);
      expect(book.getYesOrders()).toHaveLength(1);
      expect(book.getNoOrders()).toHaveLength(1);
      expect(book.getBestYes()).toEqual(restingYes);
      expect(book.getBestNo()).toEqual(restingNo);
    });

    it('returns cached book on second call without hitting DB', async () => {
      const mockRepo = {
        findByMarket: jest.fn().mockResolvedValue([]),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      await mgr.getBookForBinary(MARKET_ID);
      const callCountAfterFirst = mockRepo.findByMarket.mock.calls.length;
      await mgr.getBookForBinary(MARKET_ID);
      expect(mockRepo.findByMarket.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  describe('onOrderPlaced (binary)', () => {
    it('adds remaining order to book after partial fill', async () => {
      const restingNo = order(OrderSide.BUY_NO, 0.4, 5, 'a2');
      const mockRepo = {
        findByMarket: jest.fn().mockResolvedValue([restingNo]),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      const book = await mgr.getBookForBinary(MARKET_ID);

      const incomingYes = order(OrderSide.BUY_YES, 0.6, 10, 'a1');
      const result = MatchingEngine.matchOrder(incomingYes, book, MARKET_ID);

      expect(result.remainingOrder).not.toBeNull();
      expect(result.remainingOrder!.filledQuantity.toNumber()).toBe(5);

      mgr.onOrderPlaced(MARKET_ID, result, false);

      expect(book.getYesOrders()).toContainEqual(
        expect.objectContaining({ id: result.remainingOrder!.id })
      );
    });
  });

  describe('onOrderCancelled', () => {
    it('removes order from binary book', async () => {
      const restingYes = order(OrderSide.BUY_YES, 0.6, 10, 'a1');
      const mockRepo = {
        findByMarket: jest.fn((_m: string, s: string) =>
          Promise.resolve(s === 'PENDING' ? [restingYes] : [])
        ),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      await mgr.getBookForBinary(MARKET_ID);
      mgr.onOrderCancelled(MARKET_ID, restingYes.id, false);
      const book = await mgr.getBookForBinary(MARKET_ID);
      expect(book.getYesOrders()).toHaveLength(0);
    });

    it('removes order from futures book', async () => {
      const resting = order(OrderSide.SELL, 20, 5, 'a1');
      const mockRepo = {
        findByMarket: jest.fn((_m: string, s: string) =>
          Promise.resolve(s === 'PENDING' ? [resting] : [])
        ),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      const orders = await mgr.getRestingOrdersForFutures(MARKET_ID);
      expect(orders).toHaveLength(1);
      mgr.onOrderCancelled(MARKET_ID, resting.id, true);
      const ordersAfter = await mgr.getRestingOrdersForFutures(MARKET_ID);
      expect(ordersAfter).toHaveLength(0);
    });
  });

  describe('getRestingOrdersForFutures', () => {
    it('lazy loads from repo and caches', async () => {
      const resting = order(OrderSide.SELL, 20, 5, 'a1');
      const mockRepo = {
        findByMarket: jest.fn((_m: string, s: string) =>
          Promise.resolve(s === 'PENDING' ? [resting] : [])
        ),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      const orders1 = await mgr.getRestingOrdersForFutures(MARKET_ID);
      const orders2 = await mgr.getRestingOrdersForFutures(MARKET_ID);
      expect(orders1).toHaveLength(1);
      expect(orders2).toBe(orders1);
    });
  });

  describe('onOrderPlaced (futures)', () => {
    it('full fill: removes both orders from book when both fully filled', async () => {
      const restingBid = order(OrderSide.BUY, 20, 10, 'bidder');
      const mockRepo = {
        findByMarket: jest.fn((_m: string, s: string) =>
          Promise.resolve(s === 'PENDING' ? [restingBid] : [])
        ),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      await mgr.getRestingOrdersForFutures(MARKET_ID);
      const { matchOrderWithOss } = require('../engine/ossMatchingAdapter');
      const incomingSell = order(OrderSide.SELL, 20, 10, 'seller');
      const result = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

      expect(result.trades).toHaveLength(1);
      expect(result.filledOrderIds).toContain(restingBid.id);
      expect(result.filledOrderIds).toContain(incomingSell.id);
      expect(result.remainingOrder).toBeNull();

      mgr.onOrderPlaced(MARKET_ID, result, true);

      const ordersAfter = await mgr.getRestingOrdersForFutures(MARKET_ID);
      expect(ordersAfter).toHaveLength(0);
    });

    it('partial fill: keeps remaining order and removes fully filled counterparty', async () => {
      const restingBid = order(OrderSide.BUY, 20, 2, 'bidder');
      const mockRepo = {
        findByMarket: jest.fn((_m: string, s: string) =>
          Promise.resolve(s === 'PENDING' ? [restingBid] : [])
        ),
      };
      const mgr = new OrderBookManager(mockRepo as any);
      await mgr.getRestingOrdersForFutures(MARKET_ID);
      const { matchOrderWithOss } = require('../engine/ossMatchingAdapter');
      const incomingSell = order(OrderSide.SELL, 5, 5, 'seller');
      const result = matchOrderWithOss(incomingSell, [restingBid], MARKET_ID);

      expect(result.remainingOrder).not.toBeNull();
      expect(result.filledOrderIds).toContain(restingBid.id);
      expect(result.updatedCounterpartyOrders[0].status).toBe('FILLED');

      mgr.onOrderPlaced(MARKET_ID, result, true);

      const ordersAfter = await mgr.getRestingOrdersForFutures(MARKET_ID);
      expect(ordersAfter).toHaveLength(1);
      expect(ordersAfter[0].id).toBe(result.remainingOrder!.id);
      expect(ordersAfter[0].filledQuantity.toNumber()).toBe(2);
    });
  });
});
