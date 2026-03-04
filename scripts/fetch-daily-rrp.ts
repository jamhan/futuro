#!/usr/bin/env npx ts-node
/**
 * Fetch AEMO NEM daily average RRP for one or more regions/dates.
 * Downloads dispatch zip(s), computes average of 288 five-minute RRPs per region per day,
 * writes JSON to data/oracle/ for oracle ingestion.
 *
 * Usage:
 *   npx tsx scripts/fetch-daily-rrp.ts --zip-url <url> --date 2026-03-20
 *   npx tsx scripts/fetch-daily-rrp.ts --zip-url <url1> --zip-url <url2> --date 2026-03-20 --regions NSW1,QLD1,VIC1
 *
 * Zip URL(s): from https://www.nemweb.com.au/Reports/Current/Dispatch_Reports/
 * For a full day you may need multiple zips (each contains a time window) or an archive.
 * The script concatenates all CSVs from all zips and extracts daily average per region.
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { parseDispatchCsv, extractDailyAverageRRP } from '../src/lib/oracle/dispatchParser';
import { NEM_REGIONS } from '../src/config/oracle/aemoMarkets';

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

  const regionList = regions
    ? regions.split(',').map((r) => r.trim())
    : [...NEM_REGIONS];

  return { zipUrls, date, regions: regionList };
}

async function fetchZip(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.arrayBuffer();
}

function extractCsvFromZip(zip: AdmZip): string {
  let csvContent = '';
  const entries = zip.getEntries();
  for (const entry of entries) {
    if (!entry.isDirectory && (entry.entryName.endsWith('.CSV') || entry.entryName.endsWith('.csv'))) {
      csvContent += entry.getData().toString('utf8');
    }
  }
  return csvContent;
}

async function main() {
  const { zipUrls, date, regions } = parseArgs();

  if (zipUrls.length === 0 || !date) {
    console.error(
      'Usage: npx tsx scripts/fetch-daily-rrp.ts --zip-url <url> [--zip-url <url2> ...] --date YYYY-MM-DD [--regions NSW1,QLD1,VIC1,SA1,TAS1]'
    );
    console.error('Zip URLs from: https://www.nemweb.com.au/Reports/Current/Dispatch_Reports/');
    console.error('For a full day, you may need multiple zips covering all 288 five-minute intervals.');
    process.exit(1);
  }

  let allRows: ReturnType<typeof parseDispatchCsv> = [];
  for (const url of zipUrls) {
    const zipBuf = await fetchZip(url);
    const zip = new AdmZip(Buffer.from(zipBuf));
    const csv = extractCsvFromZip(zip);
    if (csv) {
      const rows = parseDispatchCsv(csv);
      allRows = allRows.concat(rows);
    }
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const dateNorm = date.slice(0, 10);
  let written = 0;

  for (const region of regions) {
    const avg = extractDailyAverageRRP(allRows, region, dateNorm);
    if (avg == null) {
      console.warn(`No data for region=${region} date=${dateNorm}`);
      continue;
    }

    const indexId = `${region}_daily_rrp_${dateNorm}`;
    const outPath = path.join(DATA_DIR, `${indexId}.json`);
    const out = {
      indexId,
      marketId: indexId,
      value: Math.round(avg * 100) / 100,
      region,
      date: dateNorm,
      source: 'aemo',
      collected_at: new Date().toISOString(),
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`Wrote ${outPath} (avg RRP = ${out.value} $/MWh)`);
    written++;
  }

  if (written === 0) {
    console.error('No data extracted. Ensure the zip(s) contain PUBLIC_DISPATCH rows for the given date.');
    process.exit(1);
  }

  console.log(`\nRun oracle import: curl -X POST .../api/admin/oracle/import -H "Authorization: Bearer $FUTURO_ADMIN_KEY"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
