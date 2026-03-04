import Decimal from 'decimal.js';
import { OrderValidator } from './order';
import { OrderSide, OrderType } from './types';

describe('OrderValidator', () => {
  const baseInput = {
    marketId: 'm1',
    accountId: 'a1',
    quantity: new Decimal(10),
  };

  describe('validate', () => {
    it('allows futures limit BUY with price > 1', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: new Decimal(25),
      });
      expect(errors).toHaveLength(0);
    });

    it('allows futures limit SELL with price > 1', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        price: new Decimal(0.5),
      });
      expect(errors).toHaveLength(0);
    });

    it('rejects limit order with price > 1 for binary sides (BUY_YES)', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        side: OrderSide.BUY_YES,
        type: OrderType.LIMIT,
        price: new Decimal(1.5),
      });
      expect(errors).toContain('Binary market price must be between 0.00 and 1.00');
    });

    it('rejects zero quantity', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        quantity: new Decimal(0),
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: new Decimal(10),
      });
      expect(errors).toContain('Quantity must be positive');
    });

    it('rejects limit order without price', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: null as any,
      });
      expect(errors).toContain('Limit orders must have a price');
    });

    it('rejects market order with price', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        price: new Decimal(10),
      });
      expect(errors).toContain('Market orders must not have a price');
    });

    it('allows market order with null price', () => {
      const errors = OrderValidator.validate({
        ...baseInput,
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        price: null,
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('canCancel', () => {
    it('allows PENDING order to be cancelled', () => {
      expect(OrderValidator.canCancel({ status: 'PENDING' } as any)).toBe(true);
    });

    it('allows PARTIALLY_FILLED order to be cancelled', () => {
      expect(OrderValidator.canCancel({ status: 'PARTIALLY_FILLED' } as any)).toBe(true);
    });

    it('disallows FILLED order to be cancelled', () => {
      expect(OrderValidator.canCancel({ status: 'FILLED' } as any)).toBe(false);
    });

    it('disallows CANCELLED order to be cancelled', () => {
      expect(OrderValidator.canCancel({ status: 'CANCELLED' } as any)).toBe(false);
    });
  });

  describe('remainingQuantity', () => {
    it('returns quantity minus filledQuantity', () => {
      const order = {
        quantity: new Decimal(10),
        filledQuantity: new Decimal(3),
      } as any;
      expect(OrderValidator.remainingQuantity(order).toNumber()).toBe(7);
    });
  });
});
