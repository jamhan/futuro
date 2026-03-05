import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { MarketRepository } from '../repositories/marketRepository';
import { OrderRepository } from '../repositories/orderRepository';
import { TradeRepository } from '../repositories/tradeRepository';
import { AccountRepository } from '../repositories/accountRepository';
import { LedgerService } from './ledgerService';
import { broadcast } from './wsBroadcast';
import { MatchingEngine, OrderBook } from '../engine/matching';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';
import { matchOrderWithOss } from '../engine/ossMatchingAdapter';
import { Order, createOrder, OrderInput, OrderValidator } from '../domain/order';
import { MarketLifecycle } from '../domain/market';
import { MarketState, OrderSide, OrderStatus } from '../domain/types';
import {
  OrderRejectionError,
  ORDER_REJECTION_CODES,
} from '../errors/orderRejection';
import { matchingLatencyMs } from './metrics';

/**
 * ExchangeService orchestrates all exchange operations
 * Handles order placement, matching, position updates, and balance management
 */
export class ExchangeService {
  private marketRepo = new MarketRepository();
  private orderRepo = new OrderRepository();
  private tradeRepo = new TradeRepository();
  private accountRepo = new AccountRepository();
  private ledgerService = new LedgerService();
  private prisma = getPrismaClient();

  /**
   * Place an order and attempt to match it
   * Returns trades generated and the order (possibly partially filled)
   */
  async placeOrder(input: OrderInput): Promise<{
    order: Order;
    trades: any[];
  }> {
    // Validate order
    const errors = OrderValidator.validate(input);
    if (errors.length > 0) {
      throw new OrderRejectionError(
        ORDER_REJECTION_CODES.VALIDATION_FAILED,
        `Invalid order: ${errors.join(', ')}`
      );
    }

    // Check market state
    const market = await this.marketRepo.findById(input.marketId);
    if (!market) {
      throw new OrderRejectionError(ORDER_REJECTION_CODES.MARKET_NOT_FOUND, 'Market not found');
    }

    if (!MarketLifecycle.isTradingAllowed(market.state)) {
      throw new OrderRejectionError(
        ORDER_REJECTION_CODES.TRADING_NOT_ALLOWED,
        `Trading not allowed in market state: ${market.state}`,
        { marketState: market.state }
      );
    }

    // Price bounds (for limit orders)
    if (input.type === 'LIMIT' && input.price != null) {
      const price = input.price;
      const minNum = market.minPrice != null ? Number(market.minPrice) : undefined;
      const maxNum = market.maxPrice != null ? Number(market.maxPrice) : undefined;
      if (market.minPrice != null && price.lt(market.minPrice)) {
        throw new OrderRejectionError(
          ORDER_REJECTION_CODES.PRICE_BELOW_MIN,
          `Price ${price} below market minimum ${market.minPrice}`,
          { marketMin: minNum, marketMax: maxNum }
        );
      }
      if (market.maxPrice != null && price.gt(market.maxPrice)) {
        throw new OrderRejectionError(
          ORDER_REJECTION_CODES.PRICE_ABOVE_MAX,
          `Price ${price} above market maximum ${market.maxPrice}`,
          { marketMin: minNum, marketMax: maxNum }
        );
      }

      // Tick size: 0.1 (<10), 1 (10-100), 10 (>100)
      const tick = price.lt(10) ? new Decimal(0.1) : price.lt(100) ? new Decimal(1) : new Decimal(10);
      const remainder = price.div(tick).minus(price.div(tick).round());
      if (remainder.abs().gte(0.0001)) {
        throw new OrderRejectionError(
          ORDER_REJECTION_CODES.INVALID_TICK_SIZE,
          `Price ${price} invalid: tick size ${tick} (0.1 below 10, 1 for 10-100, 10 above 100)`,
          { tick: tick.toNumber() }
        );
      }
    }

    // Check account balance (for buy orders)
    const account = await this.accountRepo.findById(input.accountId);
    if (!account) {
      throw new OrderRejectionError(ORDER_REJECTION_CODES.ACCOUNT_NOT_FOUND, 'Account not found');
    }

    const isBuy = [
      OrderSide.BUY_YES,
      OrderSide.BUY_NO,
      OrderSide.BUY,
    ].includes(input.side);
    if (isBuy) {
      const price = input.price || new Decimal(1);
      const cost = price.times(input.quantity);
      if (account.balance.lt(cost)) {
        throw new OrderRejectionError(ORDER_REJECTION_CODES.INSUFFICIENT_BALANCE, 'Insufficient balance');
      }

    }

    // Max position: ±$1000 notional per market (futures/OSS)
    if (isFuturesMarket(market)) {
      const mult = new Decimal((market.contractMultiplier ?? 1).toString());
      const currentPos = await this.accountRepo.getPosition(input.accountId, input.marketId);
      const currentQty = currentPos?.quantity ?? new Decimal(0);
      const isBuyOrder = [OrderSide.BUY].includes(input.side);
      const postTradeQty = isBuyOrder
        ? currentQty.plus(input.quantity)
        : currentQty.minus(input.quantity);
      const orderPrice = input.type === 'LIMIT' && input.price != null
        ? input.price
        : new Decimal((market.maxPrice ?? 100).toString());
      const postNotional = orderPrice.times(postTradeQty.abs()).times(mult);
      const MAX_POSITION_NOTIONAL = 1000;
      if (postNotional.gt(MAX_POSITION_NOTIONAL)) {
        throw new OrderRejectionError(
          ORDER_REJECTION_CODES.POSITION_LIMIT_EXCEEDED,
          `Position notional ${postNotional} would exceed max ±$${MAX_POSITION_NOTIONAL} per market`,
          { cap: MAX_POSITION_NOTIONAL, postNotional: postNotional.toNumber() }
        );
      }
    }

    // Create order
    const order = createOrder(input);

    const isFutures = isFuturesMarket(market);

    const matchStart = process.hrtime.bigint();
    let result;
    if (isFutures) {
      const restingOrders = await this.buildRestingOrders(input.marketId);
      result = matchOrderWithOss(order, restingOrders, input.marketId);
    } else {
      const orderBook = await this.buildOrderBook(input.marketId);
      result = MatchingEngine.matchOrder(order, orderBook, input.marketId);
    }
    const matchElapsedMs = Number(process.hrtime.bigint() - matchStart) / 1e6;
    matchingLatencyMs.observe({ market_id: input.marketId }, matchElapsedMs);

    console.log(`Matching result: ${result.trades.length} trades, ${result.updatedCounterpartyOrders.length} counterparty orders to update`);
    if (result.trades.length > 0 && result.updatedCounterpartyOrders.length === 0) {
      console.error('WARNING: Trades created but no counterparty orders to update!');
      console.error('Trade details:', result.trades.map(t => ({ buyOrderId: t.buyOrderId, sellOrderId: t.sellOrderId })));
    }
    if (result.updatedCounterpartyOrders.length > 0) {
      console.log('Counterparty orders to update:', result.updatedCounterpartyOrders.map(o => ({ id: o.id, side: o.side, status: o.status, filled: o.filledQuantity.toString() })));
    }

    // Persist everything in a single transaction so the remaining order is committed with counterparty updates.
    return await this.prisma.$transaction(async (tx) => {
      const orderToSave = result.remainingOrder ?? (() => {
        const totalFilled = result.trades.reduce(
          (sum, t) =>
            t.buyOrderId === order.id || t.sellOrderId === order.id ? sum.plus(t.quantity) : sum,
          new Decimal(0)
        );
        return {
          ...order,
          filledQuantity: totalFilled,
          status: totalFilled.gte(order.quantity) ? OrderStatus.FILLED : order.status,
        };
      })();

      const savedOrderRow = await tx.order.create({
        data: {
          id: orderToSave.id,
          marketId: orderToSave.marketId,
          accountId: orderToSave.accountId,
          side: orderToSave.side,
          type: orderToSave.type,
          price: orderToSave.price ? new Prisma.Decimal(orderToSave.price.toString()) : null,
          quantity: new Prisma.Decimal(orderToSave.quantity.toString()),
          filledQuantity: new Prisma.Decimal(orderToSave.filledQuantity.toString()),
          status: orderToSave.status,
          reasonForTrade: (input.reasonForTrade ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      const savedOrder: Order = {
        ...orderToSave,
        id: savedOrderRow.id,
        createdAt: savedOrderRow.createdAt,
        updatedAt: savedOrderRow.updatedAt,
      };

      if (result.trades.length > 0) {
        await tx.trade.createMany({
          data: result.trades.map((t) => ({
            id: t.id,
            marketId: t.marketId,
            buyOrderId: t.buyOrderId,
            sellOrderId: t.sellOrderId,
            buyerAccountId: t.buyerAccountId,
            sellerAccountId: t.sellerAccountId,
            price: new Prisma.Decimal(t.price.toString()),
            quantity: new Prisma.Decimal(t.quantity.toString()),
            buyerSide: t.buyerSide,
            takerReasonForTrade: (input.reasonForTrade ?? undefined) as Prisma.InputJsonValue | undefined,
            createdAt: t.createdAt,
          })),
        });
      }

      // Update counterparty orders (resting orders that were in the book) with their matched state.
      // The counterparty is the order that was already in the book — i.e. the one that is NOT the incoming order.
      // When incoming is BUY, counterparty = resting SELL = sellOrderId. When incoming is SELL, counterparty = resting BUY = buyOrderId.
      const counterpartyFills = new Map<string, Decimal>();
      const incomingOrderId = (result.remainingOrder ?? order).id;

      for (const trade of result.trades) {
        const counterpartyOrderId =
          trade.buyOrderId === incomingOrderId ? trade.sellOrderId : trade.buyOrderId;
        const currentFills = counterpartyFills.get(counterpartyOrderId) || new Decimal(0);
        counterpartyFills.set(counterpartyOrderId, currentFills.plus(trade.quantity));
      }

      // Update all counterparty orders in the DB so the book reflects filled quantity on next match
      for (const [orderId, additionalFills] of counterpartyFills.entries()) {
        // Get current order state from database
        const currentOrder = await tx.order.findUnique({
          where: { id: orderId },
        });
        
        if (!currentOrder) {
          console.error(`Counterparty order ${orderId} not found in database!`);
          continue;
        }
        
        // Calculate new filled quantity
        const currentFilled = new Decimal(currentOrder.filledQuantity.toString());
        const newFilled = currentFilled.plus(additionalFills);
        const totalQuantity = new Decimal(currentOrder.quantity.toString());
        
        // Determine new status
        let newStatus = currentOrder.status;
        if (newFilled.gte(totalQuantity)) {
          newStatus = 'FILLED';
        } else if (newFilled.gt(0)) {
          newStatus = 'PARTIALLY_FILLED';
        }
        
        console.log(`Updating counterparty order ${orderId}: currentFilled=${currentFilled.toString()}, adding=${additionalFills.toString()}, newFilled=${newFilled.toString()}, status=${newStatus}`);
        
        // Update the order
        const updated = await tx.order.update({
          where: { id: orderId },
          data: {
            filledQuantity: new Prisma.Decimal(newFilled.toString()),
            status: newStatus,
          },
        });
        
        console.log(`Successfully updated counterparty order ${updated.id}: status=${updated.status}, filledQuantity=${updated.filledQuantity}`);
      }

      // Update positions and balances inside the same transaction (aggregate per account to avoid lost updates)
      await this.applyTradeSettlements(tx, result.trades);

      // Look up agent names for trade broadcast
      const accountIds = [...new Set(result.trades.flatMap((t) => [t.buyerAccountId, t.sellerAccountId]))];
      const agentProfiles = await tx.agentProfile.findMany({
        where: { accountId: { in: accountIds } },
        select: { accountId: true, name: true },
      });
      const accountToName = Object.fromEntries(agentProfiles.map((p) => [p.accountId, p.name]));

      // Broadcast trades via WebSocket
      for (const t of result.trades) {
        broadcast({
          type: 'trade',
          payload: {
            marketId: t.marketId,
            tradeId: t.id,
            price: Number(t.price.toString()),
            quantity: Number(t.quantity.toString()),
            buyerSide: t.buyerSide,
            buyerAgentName: accountToName[t.buyerAccountId] ?? null,
            sellerAgentName: accountToName[t.sellerAccountId] ?? null,
          },
        });
      }

      return {
        order: savedOrder,
        trades: result.trades,
      };
    });
  }

  /**
   * Apply position and balance changes from trades. Uses tx so it commits with the order/trade writes.
   * Balance mutations flow through LedgerService; positions updated directly.
   */
  private async applyTradeSettlements(
    tx: Parameters<Parameters<ReturnType<typeof getPrismaClient>['$transaction']>[0]>[0],
    trades: any[]
  ): Promise<void> {
    if (trades.length === 0) return;

    const isFutures = trades[0].buyerSide === OrderSide.BUY;
    const balanceDeltaByAccount = new Map<string, Decimal>();
    const positionDeltaByKey = new Map<string, { qty: Decimal; yesShares: Decimal; noShares: Decimal }>();

    for (const trade of trades) {
      const cost = trade.price.times(trade.quantity);
      balanceDeltaByAccount.set(
        trade.buyerAccountId,
        (balanceDeltaByAccount.get(trade.buyerAccountId) ?? new Decimal(0)).minus(cost)
      );
      balanceDeltaByAccount.set(
        trade.sellerAccountId,
        (balanceDeltaByAccount.get(trade.sellerAccountId) ?? new Decimal(0)).plus(cost)
      );

      if (isFutures) {
        const qty = trade.quantity;
        const buyerKey = `${trade.buyerAccountId}:${trade.marketId}`;
        const sellerKey = `${trade.sellerAccountId}:${trade.marketId}`;
        const buyerPos = positionDeltaByKey.get(buyerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0) };
        const sellerPos = positionDeltaByKey.get(sellerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0) };
        buyerPos.qty = buyerPos.qty.plus(qty);
        sellerPos.qty = sellerPos.qty.minus(qty);
        positionDeltaByKey.set(buyerKey, buyerPos);
        positionDeltaByKey.set(sellerKey, sellerPos);
      } else {
        const buyerKey = `${trade.buyerAccountId}:${trade.marketId}`;
        const sellerKey = `${trade.sellerAccountId}:${trade.marketId}`;
        const buyerPos = positionDeltaByKey.get(buyerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0) };
        const sellerPos = positionDeltaByKey.get(sellerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0) };
        if (trade.buyerSide === OrderSide.BUY_YES) {
          buyerPos.yesShares = buyerPos.yesShares.plus(trade.quantity);
          sellerPos.noShares = sellerPos.noShares.plus(trade.quantity);
        } else {
          buyerPos.noShares = buyerPos.noShares.plus(trade.quantity);
          sellerPos.yesShares = sellerPos.yesShares.plus(trade.quantity);
        }
        positionDeltaByKey.set(buyerKey, buyerPos);
        positionDeltaByKey.set(sellerKey, sellerPos);
      }
    }

    // Balance mutations via ledger
    const journalLines: { accountId: string; debit: Decimal; credit: Decimal }[] = [];
    for (const [accountId, delta] of balanceDeltaByAccount.entries()) {
      if (delta.gt(0)) {
        journalLines.push({ accountId, debit: new Decimal(0), credit: delta });
      } else if (delta.lt(0)) {
        journalLines.push({ accountId, debit: delta.abs(), credit: new Decimal(0) });
      }
    }
    if (journalLines.length > 0) {
      const refId = trades.length === 1 ? trades[0].id : undefined;
      await this.ledgerService.postJournal(
        journalLines,
        { description: 'order_fill', refId },
        tx as any
      );
    }

    for (const [key, delta] of positionDeltaByKey.entries()) {
      const [accountId, marketId] = key.split(':');
      const existing = await tx.position.findUnique({
        where: { accountId_marketId: { accountId, marketId } },
      });
      const yes = (existing ? new Decimal(existing.yesShares.toString()) : new Decimal(0)).plus(delta.yesShares);
      const no = (existing ? new Decimal(existing.noShares.toString()) : new Decimal(0)).plus(delta.noShares);
      const qty = existing && existing.quantity != null
        ? new Decimal(existing.quantity.toString()).plus(delta.qty)
        : delta.qty;
      const quantityDecimal = isFutures ? new Prisma.Decimal(qty.toString()) : null;
      await tx.position.upsert({
        where: { accountId_marketId: { accountId, marketId } },
        create: {
          accountId,
          marketId,
          yesShares: new Prisma.Decimal(yes.toString()),
          noShares: new Prisma.Decimal(no.toString()),
          quantity: quantityDecimal,
        },
        update: {
          yesShares: new Prisma.Decimal(yes.toString()),
          noShares: new Prisma.Decimal(no.toString()),
          ...(isFutures && { quantity: quantityDecimal }),
        },
      });
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, accountId: string): Promise<Order> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.accountId !== accountId) {
      throw new Error('Unauthorized');
    }

    if (!OrderValidator.canCancel(order)) {
      throw new Error('Order cannot be cancelled');
    }

    return await this.orderRepo.cancel(orderId);
  }

  /**
   * Build order book from database (binary markets)
   */
  private async buildOrderBook(marketId: string): Promise<OrderBook> {
    const activeOrders = await this.getActiveOrdersForMarket(marketId);
    const orderBook = new OrderBook();
    for (const order of activeOrders) {
      orderBook.addOrder(order);
    }
    return orderBook;
  }

  /**
   * Build resting orders list for futures (OSS adapter)
   */
  private async buildRestingOrders(marketId: string): Promise<Order[]> {
    return this.getActiveOrdersForMarket(marketId);
  }

  private async getActiveOrdersForMarket(marketId: string): Promise<Order[]> {
    const pendingOrders = await this.orderRepo.findByMarket(marketId, OrderStatus.PENDING);
    const partiallyFilledOrders = await this.orderRepo.findByMarket(marketId, OrderStatus.PARTIALLY_FILLED);
    return [...pendingOrders, ...partiallyFilledOrders].filter((order) => {
      const remaining = OrderValidator.remainingQuantity(order);
      return remaining.gt(0);
    });
  }

}

