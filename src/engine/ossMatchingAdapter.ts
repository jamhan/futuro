import Decimal from 'decimal.js';
import { OrderBook as NodeOrderBook, Side as LibSide } from 'nodejs-order-book';
import { Order, OrderValidator } from '../domain/order';
import { Trade, createTrade } from '../domain/trade';
import { OrderSide, OrderType } from '../domain/types';
import type { MatchingResult } from './matching';

/** Library order shape (from nodejs-order-book) */
interface LibOrder {
  id: string;
  side: 'buy' | 'sell';
  size: number;
  origSize?: number;
  price: number;
}

/** Process order response from nodejs-order-book */
interface ProcessOrderResponse {
  done: LibOrder[];
  partial: LibOrder | null;
  partialQuantityProcessed: number;
  quantityLeft: number;
  err: Error | null;
}

/** Map our order side (BUY/SELL or legacy BUY_YES/BUY_NO) to nodejs-order-book Side enum */
function toLibSide(side: string): LibSide {
  if (side === OrderSide.BUY || side === OrderSide.BUY_YES) return LibSide.BUY;
  if (side === OrderSide.SELL || side === OrderSide.BUY_NO) return LibSide.SELL;
  throw new Error(`OSS adapter: unsupported order side "${side}" (use BUY/SELL for futures)`);
}

/**
 * Adapter that runs matching via nodejs-order-book (BUY/SELL CLOB).
 * Rehydrates book from resting orders, runs limit/market, maps result to MatchingResult.
 * All futures use this path; resting orders are normalized (BUY_YES→buy, BUY_NO→sell).
 */
export function matchOrderWithOss(
  incomingOrder: Order,
  restingOrders: Order[],
  marketId: string
): MatchingResult {
  const incomingSide = toLibSide(incomingOrder.side);

  const orderById = new Map<string, Order>();
  restingOrders.forEach((o) => orderById.set(o.id, o));
  orderById.set(incomingOrder.id, incomingOrder);

  const ob = new NodeOrderBook();

  // Rehydrate: add resting orders with remaining quantity only (normalize BUY_YES→buy, BUY_NO→sell)
  for (const o of restingOrders) {
    const remaining = OrderValidator.remainingQuantity(o);
    if (remaining.lte(0)) continue;
    const side = toLibSide(o.side);
    const price = o.price ? o.price.toNumber() : 0;
    if (price <= 0) continue; // skip invalid
    ob.limit({
      id: o.id,
      side,
      size: remaining.toNumber(),
      price,
    });
    if ((ob as any).orders[o.id] === undefined) continue; // in case of error we skip
  }
  const incomingSize = OrderValidator.remainingQuantity(incomingOrder).toNumber();
  const incomingPrice = incomingOrder.price ? incomingOrder.price.toNumber() : 0;

  let response: ProcessOrderResponse;

  if (incomingOrder.type === OrderType.MARKET) {
    response = ob.market({ side: incomingSide, size: incomingSize }) as ProcessOrderResponse;
  } else {
    if (incomingPrice <= 0) {
      return {
        trades: [],
        remainingOrder: incomingOrder,
        filledOrderIds: [],
        updatedCounterpartyOrders: [],
      };
    }
    response = ob.limit({
      id: incomingOrder.id,
      side: incomingSide,
      size: incomingSize,
      price: incomingPrice,
    }) as ProcessOrderResponse;
  }

  if (response.err) {
    throw new Error(response.err.message || 'Matching failed');
  }

  const trades: ReturnType<typeof createTrade>[] = [];
  const filledOrderIds: string[] = [];
  const updatedCounterpartyOrders: Order[] = [];

  // Build trades from filled counterparty orders (resting orders that were filled)
  for (const libOrder of response.done) {
    const ourOrder = orderById.get(libOrder.id);
    if (!ourOrder) continue;

    if (libOrder.id === incomingOrder.id) {
      filledOrderIds.push(libOrder.id);
      continue;
    }

    // This is a resting order that was fully filled
    const fillQty = libOrder.size;
    const fillPrice = new Decimal(libOrder.price);
    const buyerOrder = incomingSide === LibSide.BUY ? incomingOrder : ourOrder;
    const sellerOrder = incomingSide === LibSide.SELL ? incomingOrder : ourOrder;
    const trade = createTrade(
      { id: buyerOrder.id, accountId: buyerOrder.accountId, side: OrderSide.BUY },
      { id: sellerOrder.id, accountId: sellerOrder.accountId, side: OrderSide.SELL },
      fillPrice,
      new Decimal(fillQty),
      marketId
    );
    trades.push(trade);
    filledOrderIds.push(libOrder.id);

    const updated: Order = {
      ...ourOrder,
      filledQuantity: ourOrder.filledQuantity.plus(fillQty),
      status: 'FILLED' as any,
      updatedAt: new Date(),
    };
    updatedCounterpartyOrders.push(updated);
  }

  // Partially filled counterparty: one trade and one updated resting order (skip when partial is the incoming order)
  if (response.partial && response.partialQuantityProcessed > 0 && response.partial.id !== incomingOrder.id) {
    const libPartial = response.partial;
    const ourCounterparty = orderById.get(libPartial.id);
    if (ourCounterparty) {
      const fillQty = response.partialQuantityProcessed;
      const fillPrice = new Decimal(libPartial.price);
      const buyerOrder = incomingSide === LibSide.BUY ? incomingOrder : ourCounterparty;
      const sellerOrder = incomingSide === LibSide.SELL ? incomingOrder : ourCounterparty;
      const trade = createTrade(
        { id: buyerOrder.id, accountId: buyerOrder.accountId, side: OrderSide.BUY },
        { id: sellerOrder.id, accountId: sellerOrder.accountId, side: OrderSide.SELL },
        fillPrice,
        new Decimal(fillQty),
        marketId
      );
      trades.push(trade);

      const newFilled = ourCounterparty.filledQuantity.plus(fillQty);
      const updated: Order = {
        ...ourCounterparty,
        filledQuantity: newFilled,
        status: newFilled.gte(ourCounterparty.quantity) ? ('FILLED' as any) : ('PARTIALLY_FILLED' as any),
        updatedAt: new Date(),
      };
      updatedCounterpartyOrders.push(updated);
    }
  }

  // Incoming order: fully filled (already in done) or partially filled / pending
  let remainingOrder: Order | null = null;
  const totalFilled = trades.reduce(
    (sum, t) => (t.buyOrderId === incomingOrder.id || t.sellOrderId === incomingOrder.id ? sum.plus(t.quantity) : sum),
    new Decimal(0)
  );
  const incomingFilled = incomingOrder.filledQuantity.plus(totalFilled);
  if (incomingFilled.gte(incomingOrder.quantity)) {
    filledOrderIds.push(incomingOrder.id);
  } else {
    remainingOrder = {
      ...incomingOrder,
      filledQuantity: incomingFilled,
      status: incomingFilled.gt(0) ? ('PARTIALLY_FILLED' as any) : ('PENDING' as any),
      updatedAt: new Date(),
    };
  }

  return {
    trades,
    remainingOrder,
    filledOrderIds,
    updatedCounterpartyOrders,
  };
}
