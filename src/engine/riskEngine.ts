/**
 * Pre-trade risk engine. Validates orders before they reach the matching engine.
 * Extracted from ExchangeService for clarity and testability.
 */

import Decimal from 'decimal.js';
import { OrderInput, OrderValidator } from '../domain/order';
import { MarketLifecycle } from '../domain/market';
import { Market } from '../domain/market';
import { Account } from '../domain/account';
import { Position } from '../domain/account';
import { OrderSide } from '../domain/types';
import { isFuturesMarket } from './futuresMatchingGuard';
import { ORDER_REJECTION_CODES, OrderRejectionDetails } from '../errors/orderRejection';

const MAX_ORDER_NOTIONAL = 100;
const MAX_POSITION_NOTIONAL = 1000;
const MAX_RESTING_PER_SIDE = 2;

const D_TICK_SMALL = new Decimal(0.1);
const D_TICK_MED = new Decimal(1);
const D_TICK_LARGE = new Decimal(10);

export interface RiskCheckResult {
  passed: boolean;
  code?: string;
  message?: string;
  details?: OrderRejectionDetails;
}

export interface RiskValidateInput {
  input: OrderInput;
  market: Market;
  account: Account;
  position?: Position | null;
  restingCounts: { buy: number; sell: number };
}

/**
 * Validate an order against all pre-trade risk checks.
 * Returns passed: true if order can proceed, false with code/message/details if rejected.
 */
export function validateOrder(params: RiskValidateInput): RiskCheckResult {
  const { input, market, account, position, restingCounts } = params;

  // OrderValidator basics
  const errors = OrderValidator.validate(input);
  if (errors.length > 0) {
    return {
      passed: false,
      code: ORDER_REJECTION_CODES.VALIDATION_FAILED,
      message: `Invalid order: ${errors.join(', ')}`,
    };
  }

  // Market state
  if (!MarketLifecycle.isTradingAllowed(market.state)) {
    return {
      passed: false,
      code: ORDER_REJECTION_CODES.TRADING_NOT_ALLOWED,
      message: `Trading not allowed in market state: ${market.state}`,
      details: { marketState: market.state },
    };
  }

  // Price bounds (for limit orders)
  if (input.type === 'LIMIT' && input.price != null) {
    const price = input.price;
    const minNum = market.minPrice != null ? Number(market.minPrice) : undefined;
    const maxNum = market.maxPrice != null ? Number(market.maxPrice) : undefined;
    if (market.minPrice != null && price.lt(market.minPrice)) {
      return {
        passed: false,
        code: ORDER_REJECTION_CODES.PRICE_BELOW_MIN,
        message: `Price ${price} below market minimum ${market.minPrice}`,
        details: { marketMin: minNum, marketMax: maxNum },
      };
    }
    if (market.maxPrice != null && price.gt(market.maxPrice)) {
      return {
        passed: false,
        code: ORDER_REJECTION_CODES.PRICE_ABOVE_MAX,
        message: `Price ${price} above market maximum ${market.maxPrice}`,
        details: { marketMin: minNum, marketMax: maxNum },
      };
    }

    // Tick size: 0.1 (<10), 1 (10-100), 10 (>100)
    const tick = price.lt(10) ? D_TICK_SMALL : price.lt(100) ? D_TICK_MED : D_TICK_LARGE;
    const remainder = price.div(tick).minus(price.div(tick).round());
    if (remainder.abs().gte(0.0001)) {
      return {
        passed: false,
        code: ORDER_REJECTION_CODES.INVALID_TICK_SIZE,
        message: `Price ${price} invalid: tick size ${tick} (0.1 below 10, 1 for 10-100, 10 above 100)`,
        details: { tick: tick.toNumber() },
      };
    }
  }

  // Max order notional: price × quantity cannot exceed 100
  const orderPrice =
    input.type === 'LIMIT' && input.price != null
      ? input.price
      : new Decimal((market.maxPrice ?? 100).toString());
  const notional = orderPrice.times(input.quantity);
  if (notional.gt(MAX_ORDER_NOTIONAL)) {
    return {
      passed: false,
      code: ORDER_REJECTION_CODES.ORDER_SIZE_EXCEEDS_LIMIT,
      message: `Order notional (price × quantity) ${notional} would exceed max ${MAX_ORDER_NOTIONAL}`,
      details: { maxNotional: MAX_ORDER_NOTIONAL, notional: notional.toNumber() },
    };
  }

  // Account balance (for buy orders)
  const isBuy = [OrderSide.BUY_YES, OrderSide.BUY_NO, OrderSide.BUY].includes(input.side);
  if (isBuy) {
    const price = input.price || new Decimal(1);
    const cost = price.times(input.quantity);
    if (account.balance.lt(cost)) {
      return {
        passed: false,
        code: ORDER_REJECTION_CODES.INSUFFICIENT_BALANCE,
        message: 'Insufficient balance',
      };
    }
  }

  // Max position: ±$1000 notional per market (futures/OSS)
  if (isFuturesMarket(market)) {
    const mult = new Decimal((market.contractMultiplier ?? 1).toString());
    const currentQty = position?.quantity ?? new Decimal(0);
    const isBuyOrder = [OrderSide.BUY].includes(input.side);
    const postTradeQty = isBuyOrder
      ? currentQty.plus(input.quantity)
      : currentQty.minus(input.quantity);
    const ordPrice =
      input.type === 'LIMIT' && input.price != null
        ? input.price
        : new Decimal((market.maxPrice ?? 100).toString());
    const postNotional = ordPrice.times(postTradeQty.abs()).times(mult);
    if (postNotional.gt(MAX_POSITION_NOTIONAL)) {
      return {
        passed: false,
        code: ORDER_REJECTION_CODES.POSITION_LIMIT_EXCEEDED,
        message: `Position notional ${postNotional} would exceed max ±$${MAX_POSITION_NOTIONAL} per market`,
        details: { cap: MAX_POSITION_NOTIONAL, postNotional: postNotional.toNumber() },
      };
    }
  }

  // Max 2 resting buys or 2 resting sells per account per market
  const isBuyOrder = [OrderSide.BUY, OrderSide.BUY_YES, OrderSide.BUY_NO].includes(input.side);
  if (isBuyOrder && restingCounts.buy >= MAX_RESTING_PER_SIDE) {
    return {
      passed: false,
      code: ORDER_REJECTION_CODES.RESTING_ORDERS_LIMIT_EXCEEDED,
      message: `Max ${MAX_RESTING_PER_SIDE} active buy orders per market (you have ${restingCounts.buy})`,
      details: { limit: MAX_RESTING_PER_SIDE, current: restingCounts.buy, side: 'buy' },
    };
  }
  if (!isBuyOrder && restingCounts.sell >= MAX_RESTING_PER_SIDE) {
    return {
      passed: false,
      code: ORDER_REJECTION_CODES.RESTING_ORDERS_LIMIT_EXCEEDED,
      message: `Max ${MAX_RESTING_PER_SIDE} active sell orders per market (you have ${restingCounts.sell})`,
      details: { limit: MAX_RESTING_PER_SIDE, current: restingCounts.sell, side: 'sell' },
    };
  }

  return { passed: true };
}
