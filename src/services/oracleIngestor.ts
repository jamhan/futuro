/**
 * Oracle ingestion service: reads files from data/oracle/, writes to OracleObservation,
 * triggers resolve for LOCKED markets when observation exists.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { MarketRepository } from '../repositories/marketRepository';
import { MarketState, Outcome } from '../domain/types';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';

export interface OracleFileRecord {
  indexId?: string;
  marketId?: string;
  value: number;
  collected_at?: string;
  source?: string;
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'oracle');

export interface IngestResult {
  filesRead: number;
  observationsCreated: number;
  observationsUpdated: number;
  marketsResolved: number;
  errors: string[];
}

export class OracleIngestor {
  private prisma = getPrismaClient();
  private marketRepo = new MarketRepository();

  async ingestFromFiles(dataDir: string = DEFAULT_DATA_DIR): Promise<IngestResult> {
    const result: IngestResult = {
      filesRead: 0,
      observationsCreated: 0,
      observationsUpdated: 0,
      marketsResolved: 0,
      errors: [],
    };

    if (!fs.existsSync(dataDir)) {
      return result;
    }

    const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed: OracleFileRecord = JSON.parse(content);
        if (typeof parsed.value !== 'number') {
          result.errors.push(`${file}: invalid or missing value`);
          continue;
        }

        result.filesRead++;

        const market = await this.resolveMarket(parsed);
        if (!market) {
          result.errors.push(`${file}: no market found for indexId=${parsed.indexId} marketId=${parsed.marketId}`);
          continue;
        }

        const observedAt = parsed.collected_at
          ? new Date(parsed.collected_at)
          : new Date();
        const source = parsed.source ?? 'file';

        const existing = await this.prisma.oracleObservation.findUnique({
          where: { marketId: market.id },
        });

        await this.prisma.oracleObservation.upsert({
          where: { marketId: market.id },
          create: {
            marketId: market.id,
            value: new Prisma.Decimal(parsed.value),
            observedAt,
            source,
          },
          update: {
            value: new Prisma.Decimal(parsed.value),
            observedAt,
            source,
          },
        });

        if (existing) {
          result.observationsUpdated++;
        } else {
          result.observationsCreated++;
        }

        if (market.state === MarketState.LOCKED && isFuturesMarket(market)) {
          await this.triggerResolve(market.id, parsed.value, source);
          result.marketsResolved++;
        }
      } catch (err) {
        result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
  }

  private async resolveMarket(record: OracleFileRecord) {
    if (record.marketId) {
      const byId = await this.marketRepo.findById(record.marketId);
      if (byId) return byId;
    }
    if (record.indexId) {
      return this.marketRepo.findByIndexId(record.indexId);
    }
    return null;
  }

  private async triggerResolve(marketId: string, value: number, source: string) {
    await this.prisma.oracleResult.upsert({
      where: { marketId },
      create: {
        marketId,
        outcome: Outcome.YES,
        value: new Prisma.Decimal(value),
        source,
      },
      update: {
        outcome: Outcome.YES,
        value: new Prisma.Decimal(value),
        source,
      },
    });

    await this.marketRepo.updateState(marketId, MarketState.RESOLVED, {
      resolvedAt: new Date(),
      winningOutcome: Outcome.YES,
    });
  }
}
