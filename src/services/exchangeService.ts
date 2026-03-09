import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { MarketRepository } from '../repositories/marketRepository';
import { OrderRepository } from '../repositories/orderRepository';
import { TradeRepository } from '../repositories/tradeRepository';
import { AccountRepository } from '../repositories/accountRepository';
import { MatchingEngine, OrderBook } from '../engine/matching';
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
    const [market, account, position, restingCounts] = await Promise.all([
      this.marketRepo.findById(input.marketId),
      this.accountRepo.findById(input.accountId),
      this.accountRepo.getPosition(input.accountId, input.marketId),
      this.orderRepo.countRestingByAccountAndMarket(input.accountId, input.marketId),
    ]);

    if (!market) {
      throw new OrderRejectionError(ORDER_REJECTION_CODES.MARKET_NOT_FOUND, 'Market not found');
    }
    if (!account) {
      throw new OrderRejectionError(ORDER_REJECTION_CODES.ACCOUNT_NOT_FOUND, 'Account not found');
    }

    const positionIfFutures = isFuturesMarket(market) ? position : null;

    const riskResult = validateOrder({
      input,
      market,
      account,
      position: positionIfFutures ?? undefined,
      restingCounts,
    });
    if (!riskResult.passed) {
      throw new OrderRejectionError(
        (riskResult.code ?? ORDER_REJECTION_CODES.VALIDATION_FAILED) as any,
        riskResult.message ?? 'Order validation failed',
        riskResult.details
      );
    }

    // Create order (in-memory only; persisted in transaction)
    const order = createOrder(input);
    const isFutures = isFuturesMarket(market);

    const orderBookManager = getOrderBookManager();

    // Single transaction: acquire per-market lock, load book, match, persist.
    // pg_advisory_xact_lock serializes order placement per market and auto-releases on commit.
    return await this.prisma.$transaction(async (tx) => {
      await (tx as any).$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
        `market:${input.marketId}`
      );

      const restingOrders = await OrderRepository.findRestingForMatching(tx, input.marketId);

      const matchStart = process.hrtime.bigint();
      let result;
      if (isFutures) {
        result = matchOrderWithOss(order, restingOrders, input.marketId);
      } else {
        const orderBook = new OrderBook();
        for (const o of restingOrders) {
          orderBook.addOrder(o);
        }
        result = MatchingEngine.matchOrder(order, orderBook, input.marketId);
      }
      const matchElapsedMs = Number(process.hrtime.bigint() - matchStart) / 1e6;
      matchingLatencyMs.observe({ market_id: input.marketId }, matchElapsedMs);

      if (result.trades.length > 0 && result.updatedCounterpartyOrders.length === 0) {
        console.error('WARNING: Trades created but no counterparty orders to update!');
      }
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
      // Use result.updatedCounterpartyOrders — matching already computed final filledQuantity/status.
      await Promise.all(
        result.updatedCounterpartyOrders.map((cp) =>
          tx.order.update({
            where: { id: cp.id },
            data: {
              filledQuantity: new Prisma.Decimal(cp.filledQuantity.toString()),
              status: cp.status,
            },
          })
        )
      );

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

