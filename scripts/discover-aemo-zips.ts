#!/usr/bin/env npx ts-node
/**
 * Discover AEMO NEMWEB dispatch zip URLs for a given date.
 * Uses archive format: PUBLIC_DISPATCH_YYYYMMDD.zip
 *
 * Usage:
 *   npx tsx scripts/discover-aemo-zips.ts --date 2026-03-20
 */

import { discoverAemoZipUrlsForDate, getAemoArchiveZipUrlForDate } from '../src/lib/oracle/aemoFetcher';

function parseArgs(): { date?: string } {
  const args = process.argv.slice(2);
  let date: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) date = args[++i];
  }
  return { date };
}

async function main() {
  const { date } = parseArgs();
  if (!date) {
    console.error('Usage: npx tsx scripts/discover-aemo-zips.ts --date YYYY-MM-DD');
    process.exit(1);
  }

  const urls = await discoverAemoZipUrlsForDate(date);
  if (urls.length === 0) {
    console.log(`No archive zip found for ${date}. URL would be: ${getAemoArchiveZipUrlForDate(date)}`);
    process.exit(1);
  }
  urls.forEach((u) => console.log(u));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
