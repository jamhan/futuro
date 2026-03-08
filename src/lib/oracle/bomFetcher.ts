/**
 * BOM (Bureau of Meteorology) oracle fetcher.
 * Fetches climate data for a station and week, aggregates to weekly values, writes JSON.
 * Used by scripts/fetch-bom.ts and jobs/oracleFetchCron.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getBomMarketMappings,
  getWeekEnding,
  BOM_PRODUCT_BY_STATE,
} from '../../config/oracle/bomStations';
import { BOM_RAINFALL_STATIONS } from '../../data/bomStations';
import { parseBomJson, aggregateWeekly, getWeekBounds } from './bomParser';

async function fetchBomJson(productId: string, stationId: string): Promise<unknown> {
  const url = `https://www.bom.gov.au/fwo/${productId}/${productId}.${stationId}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`BOM fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

export interface FetchBomResult {
  written: number;
  errors: string[];
}

/**
 * Fetch BOM climate data for a station and week, write JSON files to dataDir.
 * indexId format: {stationId}_{indexType}_{weekEndStr} e.g. 066062_weather_rainfall_2026-03-23
 */
export async function fetchBomForStationWeek(
  stationId: string,
  weekEndStr: string,
  dataDir: string
): Promise<FetchBomResult> {
  const result: FetchBomResult = { written: 0, errors: [] };

  const st = BOM_RAINFALL_STATIONS.find((s) => s.id === stationId);
  if (!st) {
    result.errors.push(`Unknown station: ${stationId}`);
    return result;
  }

  const productId = BOM_PRODUCT_BY_STATE[st.state] ?? 'IDN60801';
  const weekEndDate = new Date(weekEndStr + 'T23:59:59');
  const weekEndings = [getWeekEnding(weekEndDate)];
  const mappings = getBomMarketMappings(weekEndings).filter((m) => m.stationId === stationId);

  if (mappings.length === 0) {
    result.errors.push(`No mappings for station=${stationId} week=${weekEndStr}`);
    return result;
  }

  let rawJson: unknown;
  try {
    rawJson = await fetchBomJson(productId, stationId);
  } catch (err) {
    result.errors.push(`BOM fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const records = parseBomJson(rawJson);
  const { weekStart, weekEnd } = getWeekBounds(weekEndStr);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  for (const m of mappings) {
    const value = aggregateWeekly(records, m.metric, weekStart, weekEnd);
    if (value == null) {
      result.errors.push(`No data for ${m.indexId} (${m.metric.bomField})`);
      continue;
    }

    const out = {
      indexId: m.indexId,
      stationId: m.stationId,
      metric: m.metric.bomField,
      value,
      collected_at: new Date().toISOString(),
    };

    const outPath = path.join(dataDir, `${m.indexId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    result.written++;
  }

  return result;
}
