import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';

/**
 * Call auction: aggregate valuation submissions for an interval, compute clearing price.
 * For now: clearing price = mean of fairValues, volume = submission count.
 */
export class AuctionService {
  private prisma = getPrismaClient();

  /** Get interval ID for a given date (YYYY-MM-DDTHH). */
  static getIntervalId(d: Date): string {
    return d.toISOString().slice(0, 13);
  }

  /**
   * Run auction for a given interval. Aggregates submissions per market, computes clearing price.
   */
  async runAuctionForInterval(intervalId: string): Promise<
    { marketId: string; clearingPrice: Decimal; volume: Decimal; imbalance: Decimal }[]
  > {
    const submissions = await this.prisma.valuationSubmission.findMany({
      where: { intervalId },
    });

    const byMarket = new Map<
      string,
      { fairValues: number[]; count: number }
    >();
    for (const s of submissions) {
      const existing = byMarket.get(s.marketId) ?? {
        fairValues: [],
        count: 0,
      };
      existing.fairValues.push(Number(s.fairValue.toString()));
      existing.count += 1;
      byMarket.set(s.marketId, existing);
    }

    const results: {
      marketId: string;
      clearingPrice: Decimal;
      volume: Decimal;
      imbalance: Decimal;
    }[] = [];
    for (const [marketId, { fairValues, count }] of byMarket) {
      if (fairValues.length === 0) continue;
      const mean =
        fairValues.reduce((a, b) => a + b, 0) / fairValues.length;
      results.push({
        marketId,
        clearingPrice: new Decimal(mean),
        volume: new Decimal(count),
        imbalance: new Decimal(0),
      });
    }
    return results;
  }

  /**
   * Persist auction results and return them.
   */
  async persistAndReturn(
    intervalId: string,
    results: {
      marketId: string;
      clearingPrice: Decimal;
      volume: Decimal;
      imbalance: Decimal;
    }[]
  ): Promise<void> {
    for (const r of results) {
      await this.prisma.auctionResult.upsert({
        where: {
          intervalId_marketId: { intervalId, marketId: r.marketId },
        },
        create: {
          intervalId,
          marketId: r.marketId,
          clearingPrice: new Prisma.Decimal(r.clearingPrice.toString()),
          volume: new Prisma.Decimal(r.volume.toString()),
          imbalance: new Prisma.Decimal(r.imbalance.toString()),
        },
        update: {
          clearingPrice: new Prisma.Decimal(r.clearingPrice.toString()),
          volume: new Prisma.Decimal(r.volume.toString()),
          imbalance: new Prisma.Decimal(r.imbalance.toString()),
        },
      });
    }
  }

  async runAndPersist(intervalId: string): Promise<
    { marketId: string; clearingPrice: Decimal; volume: Decimal; imbalance: Decimal }[]
  > {
    const results = await this.runAuctionForInterval(intervalId);
    await this.persistAndReturn(intervalId, results);
    return results;
  }
}
