#!/usr/bin/env npx ts-node
/**
 * Fetch BOM climate data for a station and week, aggregate to weekly value, write to data/oracle/.
 * Uses Mon–Sun calendar week (matches seed getWeekEnding).
 *
 * Usage:
 *   npx tsx scripts/fetch-bom.ts --station 066062 --week-ending 2026-03-23
 */

import * as path from 'path';
import { fetchBomForStationWeek } from '../src/lib/oracle/bomFetcher';

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

async function main() {
  const { station, weekEnding } = parseArgs();
  if (!station || !weekEnding) {
    console.error('Usage: npx tsx scripts/fetch-bom.ts --station 066062 --week-ending 2026-03-23');
    process.exit(1);
  }

  const result = await fetchBomForStationWeek(station, weekEnding, DATA_DIR);
  console.log(`Wrote ${result.written} files to ${DATA_DIR}`);
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.warn(e));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
