import { getPrismaClient } from '../db/client';
import { Market, MarketId } from '../domain/market';
import { MarketState, Outcome, MarketType } from '../domain/types';
import { Prisma } from '@prisma/client';

export class MarketRepository {
  private prisma = getPrismaClient();

  async create(market: Omit<Market, 'id' | 'createdAt'>): Promise<Market> {
    const created = await this.prisma.market.create({
      data: {
        description: market.description,
        location: market.location,
        eventDate: market.eventDate,
        condition: market.condition,
        state: market.state,
        winningOutcome: market.winningOutcome,
        marketType: market.marketType ?? MarketType.BINARY,
        indexType: market.indexType ?? null,
        indexId: market.indexId ?? null,
        lockedAt: market.lockedAt,
        resolvedAt: market.resolvedAt,
        settledAt: market.settledAt,
      },
    });

    return this.toDomain(created);
  }

  async findById(id: MarketId): Promise<Market | null> {
    const found = await this.prisma.market.findUnique({
      where: { id },
    });

    return found ? this.toDomain(found) : null;
  }

  async findAll(): Promise<Market[]> {
    const markets = await this.prisma.market.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return markets.map(this.toDomain);
  }

  async updateState(
    id: MarketId,
    state: MarketState,
    updates?: {
      lockedAt?: Date | null;
      resolvedAt?: Date | null;
      settledAt?: Date | null;
      winningOutcome?: Outcome | null;
    }
  ): Promise<Market> {
    const updated = await this.prisma.market.update({
      where: { id },
      data: {
        state,
        ...updates,
      },
    });

    return this.toDomain(updated);
  }

  private toDomain(dbMarket: {
    id: string;
    description: string;
    location: string;
    eventDate: Date;
    condition: string;
    state: string;
    winningOutcome: string | null;
    marketType: string;
    indexType: string | null;
    indexId: string | null;
    createdAt: Date;
    lockedAt: Date | null;
    resolvedAt: Date | null;
    settledAt: Date | null;
  }): Market {
    return {
      id: dbMarket.id,
      description: dbMarket.description,
      location: dbMarket.location,
      eventDate: dbMarket.eventDate,
      condition: dbMarket.condition,
      state: dbMarket.state as MarketState,
      winningOutcome: dbMarket.winningOutcome as Outcome | null,
      marketType: (dbMarket.marketType as MarketType) || MarketType.BINARY,
      indexType: dbMarket.indexType,
      indexId: dbMarket.indexId,
      createdAt: dbMarket.createdAt,
      lockedAt: dbMarket.lockedAt,
      resolvedAt: dbMarket.resolvedAt,
      settledAt: dbMarket.settledAt,
    };
  }
}

