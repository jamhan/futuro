import Decimal from 'decimal.js';
import { validateOrder } from './riskEngine';
import { OrderSide, OrderType } from '../domain/types';
import { Market } from '../domain/market';
import { MarketState, MarketType } from '../domain/types';
import { Account } from '../domain/account';
import { Position } from '../domain/account';

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    description: 'Test market',
    location: 'Test',
    eventDate: new Date(),
    condition: 'x > 0',
    state: MarketState.OPEN,
    marketType: MarketType.BINARY,
    minPrice: new Decimal(0),
    maxPrice: new Decimal(1),
    createdAt: new Date(),
    lockedAt: null,
    resolvedAt: null,
    settledAt: null,
    winningOutcome: null,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    balance: new Decimal(1000),
    createdAt: new Date(),
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    accountId: 'account-1',
    marketId: 'market-1',
    yesShares: new Decimal(0),
    noShares: new Decimal(0),
    quantity: new Decimal(0),
    ...overrides,
  };
}

describe('RiskEngine', () => {
  const validInput = {
    marketId: 'market-1',
    accountId: 'account-1',
    side: OrderSide.BUY_YES as const,
    type: OrderType.LIMIT as const,
    price: new Decimal(0.5),
    quantity: new Decimal(10),
  };

  describe('validation', () => {
    it('rejects when quantity is zero', () => {
      const result = validateOrder({
        input: { ...validInput, quantity: new Decimal(0) },
        market: makeMarket(),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });

    it('rejects when limit order has no price', () => {
      const result = validateOrder({
        input: { ...validInput, type: OrderType.LIMIT, price: null as any },
        market: makeMarket(),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('market state', () => {
    it('rejects when market is LOCKED', () => {
      const result = validateOrder({
        input: validInput,
        market: makeMarket({ state: MarketState.LOCKED }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('TRADING_NOT_ALLOWED');
    });

    it('rejects when market is RESOLVED', () => {
      const result = validateOrder({
        input: validInput,
        market: makeMarket({ state: MarketState.RESOLVED }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('TRADING_NOT_ALLOWED');
    });

    it('rejects when market is DRAFT', () => {
      const result = validateOrder({
        input: validInput,
        market: makeMarket({ state: MarketState.DRAFT }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('TRADING_NOT_ALLOWED');
    });

    it('passes when market is OPEN', () => {
      const result = validateOrder({
        input: validInput,
        market: makeMarket({ state: MarketState.OPEN }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(true);
    });
  });

  describe('price bounds', () => {
    const futuresForPrice = makeMarket({
      marketType: MarketType.FUTURES,
      minPrice: new Decimal(0),
      maxPrice: new Decimal(100),
    });

    it('rejects when price below min', () => {
      // Use price 5 with minPrice 10 - passes OrderValidator (positive) but fails market bounds
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(5),
          quantity: new Decimal(1),
        },
        market: makeMarket({
          marketType: MarketType.FUTURES,
          minPrice: new Decimal(10),
          maxPrice: new Decimal(100),
        }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('PRICE_BELOW_MIN');
    });

    it('rejects when price above max', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(105),
        },
        market: futuresForPrice,
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('PRICE_ABOVE_MAX');
    });

    it('rejects invalid tick size for price < 10 (tick 0.1)', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(5.37),
          quantity: new Decimal(1),
        }, // 5.37 not valid for tick 0.1
        market: futuresForPrice,
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('INVALID_TICK_SIZE');
    });

    it('accepts valid tick size 0.1 for price < 10', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(5.3),
          quantity: new Decimal(1),
        },
        market: futuresForPrice,
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(true);
    });

    it('accepts valid tick size 1 for price 10-100', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(45),
          quantity: new Decimal(2),
        },
        market: futuresForPrice,
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(true);
    });

    it('rejects invalid tick size for price 10-100 (tick 1)', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(45.5),
          quantity: new Decimal(1),
        },
        market: makeMarket({ marketType: MarketType.FUTURES, minPrice: new Decimal(0), maxPrice: new Decimal(100) }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('INVALID_TICK_SIZE');
    });
  });

  describe('order notional', () => {
    it('rejects when price × quantity exceeds 100', () => {
      const result = validateOrder({
        input: { ...validInput, price: new Decimal(0.5), quantity: new Decimal(250) },
        market: makeMarket(),
        account: makeAccount({ balance: new Decimal(50000) }),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('ORDER_SIZE_EXCEEDS_LIMIT');
    });

    it('passes when notional is exactly 100', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(10),
          quantity: new Decimal(10),
        },
        market: makeMarket({ maxPrice: new Decimal(100), marketType: MarketType.FUTURES }),
        account: makeAccount({ balance: new Decimal(1000) }),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(true);
    });
  });

  describe('balance', () => {
    it('rejects when insufficient balance for buy', () => {
      const result = validateOrder({
        input: { ...validInput, price: new Decimal(0.5), quantity: new Decimal(100) },
        market: makeMarket(),
        account: makeAccount({ balance: new Decimal(10) }),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_BALANCE');
    });
  });

  describe('resting orders limit', () => {
    it('rejects when max buy orders exceeded', () => {
      const result = validateOrder({
        input: { ...validInput, side: OrderSide.BUY_YES },
        market: makeMarket(),
        account: makeAccount(),
        restingCounts: { buy: 2, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('RESTING_ORDERS_LIMIT_EXCEEDED');
    });

    it('rejects when max sell orders exceeded', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.SELL,
          marketId: 'market-1',
        },
        market: makeMarket({ marketType: MarketType.FUTURES }),
        account: makeAccount(),
        restingCounts: { buy: 0, sell: 2 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('RESTING_ORDERS_LIMIT_EXCEEDED');
    });
  });

  describe('futures position limit', () => {
    const futuresMarket = makeMarket({
      marketType: MarketType.FUTURES,
      minPrice: new Decimal(0),
      maxPrice: new Decimal(100),
      contractMultiplier: new Decimal(1),
    });

    it('rejects when position notional would exceed 1000', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(50),
          quantity: new Decimal(2), // order notional 100, ok
        },
        market: futuresMarket,
        account: makeAccount({ balance: new Decimal(10000) }),
        position: makePosition({ quantity: new Decimal(20) }), // 20 * 50 = 1000; +2 => 22*50=1100
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('POSITION_LIMIT_EXCEEDED');
    });

    it('passes when position notional within limit', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.BUY,
          price: new Decimal(20),
          quantity: new Decimal(5), // order notional 100
        },
        market: futuresMarket,
        account: makeAccount({ balance: new Decimal(10000) }),
        position: makePosition({ quantity: new Decimal(0) }),
        restingCounts: { buy: 0, sell: 0 },
      });
      // 5 * 20 = 100 <= 1000
      expect(result.passed).toBe(true);
    });

    it('rejects SELL when adding to short would exceed position limit', () => {
      // Position -45, sell 4 @ 25 → -49 short. Order notional 4*25=100 (ok). Post notional 49*25=1225 > 1000
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.SELL,
          price: new Decimal(25),
          quantity: new Decimal(4),
        },
        market: futuresMarket,
        account: makeAccount({ balance: new Decimal(10000) }),
        position: makePosition({ quantity: new Decimal(-45) }),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(false);
      expect(result.code).toBe('POSITION_LIMIT_EXCEEDED');
    });

    it('passes SELL when opening short within limit (order notional ≤ 100)', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.SELL,
          price: new Decimal(20),
          quantity: new Decimal(5), // order notional 100, short 5*20=100
        },
        market: futuresMarket,
        account: makeAccount({ balance: new Decimal(10000) }),
        position: makePosition({ quantity: new Decimal(0) }),
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(true);
    });

    it('passes SELL when reducing long position (within limit)', () => {
      const result = validateOrder({
        input: {
          ...validInput,
          side: OrderSide.SELL,
          price: new Decimal(10),
          quantity: new Decimal(5),
        },
        market: futuresMarket,
        account: makeAccount({ balance: new Decimal(10000) }),
        position: makePosition({ quantity: new Decimal(10) }), // 10 - 5 = 5 long after
        restingCounts: { buy: 0, sell: 0 },
      });
      expect(result.passed).toBe(true);
    });
  });
});
