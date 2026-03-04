import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { Trade, TradeId, MarketId } from '../domain/trade';

export class TradeRepository {
  private prisma = getPrismaClient();

  async create(trade: Trade): Promise<Trade> {
    const created = await this.prisma.trade.create({
      data: {
        id: trade.id,
        marketId: trade.marketId,
        buyOrderId: trade.buyOrderId,
        sellOrderId: trade.sellOrderId,
        buyerAccountId: trade.buyerAccountId,
        sellerAccountId: trade.sellerAccountId,
        price: new Prisma.Decimal(trade.price.toString()),
        quantity: new Prisma.Decimal(trade.quantity.toString()),
        buyerSide: trade.buyerSide,
        createdAt: trade.createdAt,
      },
    });

    return this.toDomain(created);
  }

  async createMany(trades: Trade[]): Promise<Trade[]> {
    if (trades.length === 0) return [];

    await this.prisma.trade.createMany({
      data: trades.map((trade) => ({
        id: trade.id,
        marketId: trade.marketId,
        buyOrderId: trade.buyOrderId,
        sellOrderId: trade.sellOrderId,
        buyerAccountId: trade.buyerAccountId,
        sellerAccountId: trade.sellerAccountId,
        price: new Prisma.Decimal(trade.price.toString()),
        quantity: new Prisma.Decimal(trade.quantity.toString()),
        buyerSide: trade.buyerSide,
        createdAt: trade.createdAt,
      })),
    });

    return trades;
  }

  async findByMarket(marketId: MarketId, limit = 100): Promise<Trade[]> {
    const trades = await this.prisma.trade.findMany({
      where: { marketId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return trades.map(this.toDomain);
  }

  private toDomain(dbTrade: {
    id: string;
    marketId: string;
    buyOrderId: string;
    sellOrderId: string;
    buyerAccountId: string;
    sellerAccountId: string;
    price: any;
    quantity: any;
    buyerSide: string;
    createdAt: Date;
  }): Trade {
    return {
      id: dbTrade.id,
      marketId: dbTrade.marketId,
      buyOrderId: dbTrade.buyOrderId,
      sellOrderId: dbTrade.sellOrderId,
      buyerAccountId: dbTrade.buyerAccountId,
      sellerAccountId: dbTrade.sellerAccountId,
      price: new Decimal(dbTrade.price.toString()),
      quantity: new Decimal(dbTrade.quantity.toString()),
      buyerSide: dbTrade.buyerSide as any,
      createdAt: dbTrade.createdAt,
    };
  }
}

