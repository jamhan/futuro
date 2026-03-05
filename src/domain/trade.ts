import Decimal from 'decimal.js';
import {
  TradeId,
  OrderId,
  MarketId,
  AccountId,
  Price,
  Quantity,
  OrderSide,
} from './types';

export type { TradeId, OrderId, MarketId, AccountId };

import type { ReasonForTrade } from './order';

/**
 * Trade represents a matched order pair
 *
 * Each trade has:
 * - A buyer (buying YES or NO)
 * - A seller (selling YES or NO)
 * - A price and quantity
 * - Timestamp
 * - takerReasonForTrade: reasoning from the incoming (taker) order, when present
 */
export interface Trade {
  id: TradeId;
  marketId: MarketId;
  buyOrderId: OrderId;
  sellOrderId: OrderId;
  buyerAccountId: AccountId;
  sellerAccountId: AccountId;
  price: Price;
  quantity: Quantity;
  buyerSide: OrderSide; // What the buyer is buying (YES or NO)
  takerReasonForTrade?: ReasonForTrade | null;
  createdAt: Date;
}

/**
 * Create a trade from two matched orders
 */
export function createTrade(
  buyOrder: { id: OrderId; accountId: AccountId; side: OrderSide },
  sellOrder: { id: OrderId; accountId: AccountId; side: OrderSide },
  price: Price,
  quantity: Quantity,
  marketId: MarketId
): Trade {
  return {
    id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    marketId,
    buyOrderId: buyOrder.id,
    sellOrderId: sellOrder.id,
    buyerAccountId: buyOrder.accountId,
    sellerAccountId: sellOrder.accountId,
    price,
    quantity,
    buyerSide: buyOrder.side,
    createdAt: new Date(),
  };
}

