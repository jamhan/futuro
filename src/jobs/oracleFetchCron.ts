/**
 * Oracle fetch cron: fetches BOM/AEMO data for LOCKED markets, writes to volume, then ingests.
 * Combined fetch+ingest pipeline under a single lock. Replaces standalone oracle ingestion for production.
 */

import cron from 'node-cron';
import { getPrismaClient } from '../db/client';
import { withJobLock } from '../lib/jobLock';
import { OracleIngestor } from '../services/oracleIngestor';
import { fetchBomForStationWeek } from '../lib/oracle/bomFetcher';
import {
  discoverAemoZipUrlsForDate,
  fetchAemoDailyForRegionsAndDate,
} from '../lib/oracle/aemoFetcher';
const ORACLE_PIPELINE_CRON = process.env.ORACLE_FETCH_CRON ?? '0 6 * * *'; // Daily 6am UTC
const DEFAULT_DATA_DIR = '/app/data/oracle';

/** Parse BOM weekly indexId: {stationId}_{indexType}_{weekEndStr} e.g. 066062_weather_rainfall_2026-03-23 */
function parseBomWeeklyIndexId(indexId: string): { stationId: string; weekEndStr: string } | null {
  const match = indexId.match(/^(\d{6})_.+_(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { stationId: match[1], weekEndStr: match[2] };
}

/** Parse AEMO daily indexId: {region}_daily_rrp_{date} e.g. NSW1_daily_rrp_2026-03-20 */
function parseAemoDailyIndexId(indexId: string): { region: string; date: string } | null {
  const match = indexId.match(/^([A-Z0-9]+)_daily_rrp_(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { region: match[1], date: match[2] };
}

export function startOracleFetchCron(): void {
  cron.schedule(ORACLE_PIPELINE_CRON, async () => {
    try {
      const { ran } = await withJobLock('oracle_pipeline', async () => {
        const dataDir = process.env.ORACLE_DATA_DIR ?? DEFAULT_DATA_DIR;

        const prisma = getPrismaClient();
        const lockedMarkets = await prisma.market.findMany({
          where: {
            state: 'LOCKED',
            indexId: { not: null },
            oracleObservation: null,
          },
          select: { indexId: true },
        });

        const bomPairs = new Map<string, { stationId: string; weekEndStr: string }>();
        const aemoByDate = new Map<string, Set<string>>();

        for (const m of lockedMarkets) {
          const id = m.indexId;
          if (!id) continue;

          const bom = parseBomWeeklyIndexId(id);
          if (bom) {
            const key = `${bom.stationId}:${bom.weekEndStr}`;
            if (!bomPairs.has(key)) bomPairs.set(key, bom);
            continue;
          }

          const aemo = parseAemoDailyIndexId(id);
          if (aemo) {
            const regions = aemoByDate.get(aemo.date) ?? new Set();
            regions.add(aemo.region);
            aemoByDate.set(aemo.date, regions);
          }
        }

        let bomWritten = 0;
        let bomErrors: string[] = [];

        for (const { stationId, weekEndStr } of bomPairs.values()) {
          const result = await fetchBomForStationWeek(stationId, weekEndStr, dataDir);
          bomWritten += result.written;
          bomErrors.push(...result.errors);
        }

        let aemoWritten = 0;
        let aemoErrors: string[] = [];

        for (const [dateStr, regions] of aemoByDate) {
          const zipUrls = await discoverAemoZipUrlsForDate(dateStr);
          const result = await fetchAemoDailyForRegionsAndDate(
            [...regions],
            dateStr,
            zipUrls,
            dataDir
          );
          aemoWritten += result.written;
          aemoErrors.push(...result.errors);
        }

        console.log(
          `[oracleFetch] bomWritten=${bomWritten} aemoWritten=${aemoWritten} bomErrors=${bomErrors.length} aemoErrors=${aemoErrors.length}`
        );
        if (bomErrors.length > 0) console.warn('[oracleFetch] BOM errors:', bomErrors);
        if (aemoErrors.length > 0) console.warn('[oracleFetch] AEMO errors:', aemoErrors);

        const ingestor = new OracleIngestor();
        const ingestResult = await ingestor.ingestFromFiles(dataDir);
        console.log(
          `[oracleIngestion] filesRead=${ingestResult.filesRead} observationsCreated=${ingestResult.observationsCreated} marketsResolved=${ingestResult.marketsResolved} errors=${ingestResult.errors.length}`
        );
        if (ingestResult.errors.length > 0) {
          console.warn('[oracleIngestion] Errors:', ingestResult.errors);
        }
      });

      if (!ran) {
        console.log('[oracleFetch] Skipped (lock held by another process)');
      }
    } catch (err) {
      console.error('[oracleFetch] Error:', err);
    }
  });
  console.log(`[oracleFetch] Pipeline cron scheduled: ${ORACLE_PIPELINE_CRON}`);
}
