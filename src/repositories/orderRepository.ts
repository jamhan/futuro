import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { Order, OrderId, MarketId, AccountId } from '../domain/order';
import { OrderStatus } from '../domain/types';

export class OrderRepository {
  private prisma = getPrismaClient();

  async create(order: Order): Promise<Order> {
    const created = await this.prisma.order.create({
      data: {
        id: order.id,
        marketId: order.marketId,
        accountId: order.accountId,
        side: order.side,
        type: order.type,
        price: order.price ? new Prisma.Decimal(order.price.toString()) : null,
        quantity: new Prisma.Decimal(order.quantity.toString()),
        filledQuantity: new Prisma.Decimal(order.filledQuantity.toString()),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });

    return this.toDomain(created);
  }

  async findById(id: OrderId): Promise<Order | null> {
    const found = await this.prisma.order.findUnique({
      where: { id },
    });

    return found ? this.toDomain(found) : null;
  }

  async findByMarket(marketId: MarketId, status?: OrderStatus): Promise<Order[]> {
    const where: any = { marketId };
    if (status) {
      where.status = status;
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    return orders.map(this.toDomain);
  }

  /** Count resting (PENDING or PARTIALLY_FILLED) orders by account and market, split by buy/sell. */
  async countRestingByAccountAndMarket(
    accountId: string,
    marketId: MarketId
  ): Promise<{ buy: number; sell: number }> {
    const resting = await this.prisma.order.findMany({
      where: {
        accountId,
        marketId,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIALLY_FILLED] },
      },
      select: { side: true },
    });
    const BUY_SIDES = ['BUY', 'BUY_YES', 'BUY_NO'];
    const buy = resting.filter((o) => BUY_SIDES.includes(o.side)).length;
    const sell = resting.filter((o) => o.side === 'SELL').length;
    return { buy, sell };
  }

  async update(order: Order): Promise<Order> {
    // Prisma will automatically update updatedAt due to @updatedAt in schema
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        filledQuantity: new Prisma.Decimal(order.filledQuantity.toString()),
        status: order.status,
        // updatedAt is handled automatically by Prisma
      },
    });

    return this.toDomain(updated);
  }

  async cancel(id: OrderId): Promise<Order> {
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: OrderStatus.CANCELLED,
        updatedAt: new Date(),
      },
    });

    return this.toDomain(updated);
  }

  /**
   * Load resting (PENDING + PARTIALLY_FILLED) orders for a market, filtered by remaining quantity.
   * Single query, one Decimal conversion per field per order.
   */
  static async findRestingForMatching(tx: { order: { findMany: any } }, marketId: MarketId): Promise<Order[]> {
    const rows = await tx.order.findMany({
      where: {
        marketId,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIALLY_FILLED] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const orders: Order[] = [];
    for (const o of rows) {
      const filled = new Decimal(o.filledQuantity.toString());
      const qty = new Decimal(o.quantity.toString());
      if (!qty.gt(filled)) continue;
      orders.push({
        id: o.id,
        marketId: o.marketId,
        accountId: o.accountId,
        side: o.side as any,
        type: o.type as any,
        price: o.price ? new Decimal(o.price.toString()) : null,
        quantity: qty,
        filledQuantity: filled,
        status: o.status as OrderStatus,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      } as Order);
    }
    return orders;
  }

  private toDomain(dbOrder: {
    id: string;
    marketId: string;
    accountId: string;
    side: string;
    type: string;
    price: any;
    quantity: any;
    filledQuantity: any;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): Order {
    return {
      id: dbOrder.id,
      marketId: dbOrder.marketId,
      accountId: dbOrder.accountId,
      side: dbOrder.side as any,
      type: dbOrder.type as any,
      price: dbOrder.price ? new Decimal(dbOrder.price.toString()) : null,
      quantity: new Decimal(dbOrder.quantity.toString()),
      filledQuantity: new Decimal(dbOrder.filledQuantity.toString()),
      status: dbOrder.status as OrderStatus,
      createdAt: dbOrder.createdAt,
      updatedAt: dbOrder.updatedAt,
    };
  }
}

