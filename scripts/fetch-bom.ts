#!/usr/bin/env npx ts-node
/**
 * Fetch BOM climate data for a station and week, aggregate to weekly value, write to data/oracle/.
 * Uses Mon–Sun calendar week (matches seed getWeekEnding).
 *
 * Usage:
 *   npx tsx scripts/fetch-bom.ts --station 066062 --week-ending 2026-03-23
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getBomMarketMappings,
  getWeekEnding,
  BOM_PRODUCT_BY_STATE,
} from '../src/config/oracle/bomStations';
import { BOM_RAINFALL_STATIONS } from '../src/data/bomStations';
import { parseBomJson, aggregateWeekly, getWeekBounds } from '../src/lib/oracle/bomParser';

const DATA_DIR = path.join(process.cwd(), 'data', 'oracle');

function parseArgs(): { station?: string; weekEnding?: string } {
  const args = process.argv.slice(2);
  let station: string | undefined;
  let weekEnding: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--station' && args[i + 1]) station = args[++i];
    else if (args[i] === '--week-ending' && args[i + 1]) weekEnding = args[++i];
  }
  return { station, weekEnding };
}

async function fetchBomJson(productId: string, stationId: string): Promise<unknown> {
  const url = `https://www.bom.gov.au/fwo/${productId}/${productId}.${stationId}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`BOM fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function main() {
  const { station, weekEnding } = parseArgs();
  if (!station || !weekEnding) {
    console.error('Usage: npx tsx scripts/fetch-bom.ts --station 066062 --week-ending 2026-03-23');
    process.exit(1);
  }

  const st = BOM_RAINFALL_STATIONS.find((s) => s.id === station);
  if (!st) {
    console.error(`Unknown station: ${station}`);
    process.exit(1);
  }

  const productId = BOM_PRODUCT_BY_STATE[st.state] ?? 'IDN60801';
  const weekEndDate = new Date(weekEnding + 'T23:59:59');
  const weekEndings = [getWeekEnding(weekEndDate)];
  const mappings = getBomMarketMappings(weekEndings).filter((m) => m.stationId === station);

  if (mappings.length === 0) {
    console.error('No mappings for station/week');
    process.exit(1);
  }

  let rawJson: unknown;
  try {
    rawJson = await fetchBomJson(productId, station);
  } catch (err) {
    console.error('Failed to fetch BOM data:', err);
    process.exit(1);
  }

  const records = parseBomJson(rawJson);
  const { weekStart, weekEnd } = getWeekBounds(weekEnding);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let written = 0;
  for (const m of mappings) {
    const value = aggregateWeekly(records, m.metric, weekStart, weekEnd);
    if (value == null) {
      console.warn(`No data for ${m.indexId} (${m.metric.bomField})`);
      continue;
    }

    const out = {
      indexId: m.indexId,
      stationId: m.stationId,
      metric: m.metric.bomField,
      value,
      collected_at: new Date().toISOString(),
    };

    const outPath = path.join(DATA_DIR, `${m.indexId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    written++;
  }

  console.log(`Wrote ${written} files to ${DATA_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
