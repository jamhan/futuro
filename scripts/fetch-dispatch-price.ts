#!/usr/bin/env npx ts-node
/**
 * Fetch AEMO NEM dispatch price for a region/interval, write to data/oracle/.
 *
 * Usage:
 *   npx tsx scripts/fetch-dispatch-price.ts --zip-url <url> --region NSW1 --interval "2026-03-20T18:00:00+11:00" --market-id NSW_CAP_20260320_1800
 *
 * Zip URL: from https://www.nemweb.com.au/Reports/Current/Dispatch_Reports/
 * SETTLEMENTDATE uses NEM market time (AEDT/AEST); interval should match desired 5-min dispatch interval.
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { parseDispatchCsv, extractPriceForInterval } from '../src/lib/oracle/dispatchParser';
const DATA_DIR = path.join(process.cwd(), 'data', 'oracle');

function parseArgs(): {
  zipUrl?: string;
  region?: string;
  interval?: string;
  marketId?: string;
} {
  const args = process.argv.slice(2);
  let zipUrl: string | undefined;
  let region: string | undefined;
  let interval: string | undefined;
  let marketId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--zip-url' && args[i + 1]) zipUrl = args[++i];
    else if (args[i] === '--region' && args[i + 1]) region = args[++i];
    else if (args[i] === '--interval' && args[i + 1]) interval = args[++i];
    else if (args[i] === '--market-id' && args[i + 1]) marketId = args[++i];
  }
  return { zipUrl, region, interval, marketId };
}

async function fetchZip(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.arrayBuffer();
}

async function main() {
  const { zipUrl, region, interval, marketId } = parseArgs();

  if (!zipUrl) {
    console.error(`Usage: npx tsx scripts/fetch-dispatch-price.ts --zip-url <url> --region NSW1 --interval "2026-03-20T18:00:00+11:00" --market-id NSW_CAP_20260320_1800`);
    console.error('Zip URL from: https://www.nemweb.com.au/Reports/Current/Dispatch_Reports/');
    process.exit(1);
  }

  const regionId = region ?? 'NSW1';
  const intervalStr = interval ?? new Date().toISOString().slice(0, 19);
  const outMarketId = marketId ?? `AEMO_${regionId}_${intervalStr.replace(/[:T-]/g, '').slice(0, 12)}`;

  let zipBuf: ArrayBuffer;
  try {
    zipBuf = await fetchZip(zipUrl);
  } catch (err) {
    console.error('Failed to fetch zip:', err);
    process.exit(1);
  }

  const zip = new AdmZip(Buffer.from(zipBuf));
  const entries = zip.getEntries();
  let csvContent = '';
  for (const entry of entries) {
    if (entry.entryName.endsWith('.CSV') || entry.entryName.endsWith('.csv')) {
      csvContent += entry.getData().toString('utf8');
      break; // usually one main CSV per zip
    }
  }
  if (!csvContent) {
    for (const entry of entries) {
      if (!entry.isDirectory) {
        csvContent += entry.getData().toString('utf8');
      }
    }
  }

  const rows = parseDispatchCsv(csvContent);
  const price = extractPriceForInterval(rows, regionId, intervalStr);

  if (price == null) {
    console.error('No price found for region=%s interval=%s', regionId, intervalStr);
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const dateStr = intervalStr.slice(0, 10).replace(/-/g, '');
  const outPath = path.join(DATA_DIR, `${outMarketId}_${dateStr}.json`);
  const out = {
    marketId: outMarketId,
    indexId: outMarketId,
    region: regionId,
    interval: intervalStr,
    value: price,
    collected_at: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
