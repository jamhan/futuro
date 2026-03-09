import Decimal from 'decimal.js';
import { computeCostBasis } from './tradeSettlementMath';

function t(price: number, qty: number) {
  return { price: new Decimal(price), qty: new Decimal(qty) };
}

describe('tradeSettlementMath', () => {
  describe('computeCostBasis', () => {
    it('opening long: first trade sets avg price', () => {
      const r = computeCostBasis(
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        [t(50, 10)]
      );
      expect(r.quantity.toNumber()).toBe(10);
      expect(r.averagePrice.toNumber()).toBe(50);
      expect(r.realizedPnl.toNumber()).toBe(0);
    });

    it('adding to long: weighted average', () => {
      const r = computeCostBasis(
        new Decimal(10),
        new Decimal(50),
        new Decimal(0),
        [t(60, 10)]
      );
      expect(r.quantity.toNumber()).toBe(20);
      expect(r.averagePrice.toNumber()).toBe(55); // (10*50 + 10*60) / 20
      expect(r.realizedPnl.toNumber()).toBe(0);
    });

    it('closing partial long: realized PnL', () => {
      const r = computeCostBasis(
        new Decimal(10),
        new Decimal(50),
        new Decimal(0),
        [t(60, -5)]
      );
      expect(r.quantity.toNumber()).toBe(5);
      expect(r.averagePrice.toNumber()).toBe(50);
      expect(r.realizedPnl.toNumber()).toBe(50); // 5 * (60 - 50)
    });

    it('closing full long: realized PnL, qty zero', () => {
      const r = computeCostBasis(
        new Decimal(10),
        new Decimal(50),
        new Decimal(0),
        [t(60, -10)]
      );
      expect(r.quantity.toNumber()).toBe(0);
      expect(r.averagePrice.toNumber()).toBe(0);
      expect(r.realizedPnl.toNumber()).toBe(100); // 10 * (60 - 50)
    });

    it('opening short: first trade', () => {
      const r = computeCostBasis(
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        [t(50, -10)]
      );
      expect(r.quantity.toNumber()).toBe(-10);
      expect(r.averagePrice.toNumber()).toBe(50);
      expect(r.realizedPnl.toNumber()).toBe(0);
    });

    it('adding to short: weighted average', () => {
      const r = computeCostBasis(
        new Decimal(-10),
        new Decimal(50),
        new Decimal(0),
        [t(40, -10)]
      );
      expect(r.quantity.toNumber()).toBe(-20);
      expect(r.averagePrice.toNumber()).toBe(45); // (10*50 + 10*40) / 20
      expect(r.realizedPnl.toNumber()).toBe(0);
    });

    it('closing partial short: realized PnL', () => {
      const r = computeCostBasis(
        new Decimal(-10),
        new Decimal(50),
        new Decimal(0),
        [t(40, 5)]
      );
      expect(r.quantity.toNumber()).toBe(-5);
      expect(r.averagePrice.toNumber()).toBe(50);
      expect(r.realizedPnl.toNumber()).toBe(50); // 5 * (50 - 40)
    });

    it('multiple trades: open, add, partial close', () => {
      const r = computeCostBasis(
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        [t(100, 5), t(110, 5), t(105, -4)]
      );
      expect(r.quantity.toNumber()).toBe(6); // 5+5-4
      expect(r.averagePrice.toNumber()).toBe(105); // (5*100+5*110)/10 = 105
      expect(r.realizedPnl.toNumber()).toBe(0); // 4 * (105-105) = 0 (closed at avg)
    });

    it('loss on close: negative realized PnL', () => {
      const r = computeCostBasis(
        new Decimal(10),
        new Decimal(50),
        new Decimal(0),
        [t(40, -10)]
      );
      expect(r.quantity.toNumber()).toBe(0);
      expect(r.realizedPnl.toNumber()).toBe(-100); // 10 * (40 - 50)
    });

    it('empty trades: unchanged', () => {
      const r = computeCostBasis(
        new Decimal(10),
        new Decimal(50),
        new Decimal(25),
        []
      );
      expect(r.quantity.toNumber()).toBe(10);
      expect(r.averagePrice.toNumber()).toBe(50);
      expect(r.realizedPnl.toNumber()).toBe(25);
    });
  });
});
