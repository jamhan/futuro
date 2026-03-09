import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { MarketRepository } from '../repositories/marketRepository';
import { OrderRepository } from '../repositories/orderRepository';
import { TradeRepository } from '../repositories/tradeRepository';
import { AccountRepository } from '../repositories/accountRepository';
import { MatchingEngine } from '../engine/matching';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';
import { matchOrderWithOss } from '../engine/ossMatchingAdapter';
import { validateOrder } from '../engine/riskEngine';
import { getOrderBookManager } from './orderBookManager';
import { Order, createOrder, OrderInput, OrderValidator } from '../domain/order';
import { OrderStatus } from '../domain/types';
import {
  OrderRejectionError,
  ORDER_REJECTION_CODES,
} from '../errors/orderRejection';
import { matchingLatencyMs } from './metrics';
import { emit } from '../events/eventBus';

/**
 * ExchangeService orchestrates all exchange operations
 * Handles order placement, matching, position updates, and balance management
 */
export class ExchangeService {
  private marketRepo = new MarketRepository();
  private orderRepo = new OrderRepository();
  private tradeRepo = new TradeRepository();
  private accountRepo = new AccountRepository();
  private prisma = getPrismaClient();

  /**
   * Place an order and attempt to match it
   * Returns trades generated and the order (possibly partially filled)
   */
  async placeOrder(input: OrderInput): Promise<{
    order: Order;
    trades: any[];
  }> {
    const market = await this.marketRepo.findById(input.marketId);
    if (!market) {
      throw new OrderRejectionError(ORDER_REJECTION_CODES.MARKET_NOT_FOUND, 'Market not found');
    }

    const account = await this.accountRepo.findById(input.accountId);
    if (!account) {
      throw new OrderRejectionError(ORDER_REJECTION_CODES.ACCOUNT_NOT_FOUND, 'Account not found');
    }

    const position = isFuturesMarket(market)
      ? await this.accountRepo.getPosition(input.accountId, input.marketId)
      : null;
    const restingCounts = await this.orderRepo.countRestingByAccountAndMarket(
      input.accountId,
      input.marketId
    );

    const riskResult = validateOrder({
      input,
      market,
      account,
      position: position ?? undefined,
      restingCounts,
    });
    if (!riskResult.passed) {
      throw new OrderRejectionError(
        (riskResult.code ?? ORDER_REJECTION_CODES.VALIDATION_FAILED) as any,
        riskResult.message ?? 'Order validation failed',
        riskResult.details
      );
    }

    // Create order
    const order = createOrder(input);

    const isFutures = isFuturesMarket(market);

    const orderBookManager = getOrderBookManager();
    const matchStart = process.hrtime.bigint();
    let result;
    if (isFutures) {
      const restingOrders = await orderBookManager.getRestingOrdersForFutures(input.marketId);
      result = matchOrderWithOss(order, restingOrders, input.marketId);
    } else {
      const orderBook = await orderBookManager.getBookForBinary(input.marketId);
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

      // Ledger, positions, and broadcast via event handlers
      await emit(
        { type: 'TradeEvent', payload: { trades: result.trades } },
        tx
      );

      const ret = { order: savedOrder, trades: result.trades };
      orderBookManager.onOrderPlaced(input.marketId, result, isFutures);
      return ret;
    });
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

    const cancelled = await this.orderRepo.cancel(orderId);
    const market = await this.marketRepo.findById(order.marketId);
    if (market) {
      getOrderBookManager().onOrderCancelled(
        order.marketId,
        orderId,
        isFuturesMarket(market)
      );
    }
    return cancelled;
  }
}

