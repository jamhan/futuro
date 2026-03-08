#!/usr/bin/env npx ts-node
/**
 * Fetch AEMO NEM daily average RRP for one or more regions/dates.
 * Downloads dispatch zip(s), computes average of 288 five-minute RRPs per region per day,
 * writes JSON to data/oracle/ for oracle ingestion.
 *
 * Usage:
 *   npx tsx scripts/fetch-daily-rrp.ts --date 2026-03-20
 *   npx tsx scripts/fetch-daily-rrp.ts --zip-url <url> --date 2026-03-20 --regions NSW1,QLD1,VIC1
 *
 * If --zip-url is omitted, discovers archive URL (PUBLIC_DISPATCH_YYYYMMDD.zip).
 */

import * as path from 'path';
import { fetchAemoDailyForRegionsAndDate } from '../src/lib/oracle/aemoFetcher';

const DATA_DIR = path.join(process.cwd(), 'data', 'oracle');

function parseArgs(): {
  zipUrls: string[];
  date: string;
  regions: string[];
} {
  const args = process.argv.slice(2);
  const zipUrls: string[] = [];
  let date = '';
  let regions = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--zip-url' && args[i + 1]) {
      zipUrls.push(args[++i]);
    } else if (args[i] === '--date' && args[i + 1]) {
      date = args[++i];
    } else if (args[i] === '--regions' && args[i + 1]) {
      regions = args[++i];
    }
  }

  const regionList = regions ? regions.split(',').map((r) => r.trim()) : [];

  return { zipUrls, date, regions: regionList };
}

async function main() {
  const { zipUrls, date, regions } = parseArgs();

  if (!date) {
    console.error(
      'Usage: npx tsx scripts/fetch-daily-rrp.ts --date YYYY-MM-DD [--zip-url <url> ...] [--regions NSW1,QLD1,VIC1,SA1,TAS1]'
    );
    console.error('If --zip-url omitted, uses AEMO archive (PUBLIC_DISPATCH_YYYYMMDD.zip).');
    process.exit(1);
  }

  const result = await fetchAemoDailyForRegionsAndDate(regions, date, zipUrls, DATA_DIR);

  if (result.written === 0) {
    console.error('No data extracted. Ensure the zip(s) contain PUBLIC_DISPATCH rows for the given date.');
    result.errors.forEach((e) => console.error(e));
    process.exit(1);
  }

  console.log(`Wrote ${result.written} files to ${DATA_DIR}`);
  if (result.errors.length > 0) result.errors.forEach((e) => console.warn(e));
  console.log(`\nRun oracle import: curl -X POST .../api/admin/oracle/import -H "Authorization: Bearer $FUTURO_ADMIN_KEY"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
