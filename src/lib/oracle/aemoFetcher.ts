/**
 * AEMO NEM oracle fetcher.
 * Fetches daily average RRP from dispatch reports, writes JSON.
 * Used by scripts/fetch-daily-rrp.ts and jobs/oracleFetchCron.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { parseDispatchCsv, extractDailyAverageRRP } from './dispatchParser';
import { NEM_REGIONS } from '../../config/oracle/aemoMarkets';


const NEMWEB_ARCHIVE_BASE = 'https://www.nemweb.com.au/Reports/Archive/Dispatch_Reports';

/**
 * Get zip URL(s) for a given date. Uses AEMO archive format: PUBLIC_DISPATCH_YYYYMMDD.zip
 */
export function getAemoArchiveZipUrlForDate(dateStr: string): string {
  const norm = dateStr.slice(0, 10).replace(/-/g, '');
  return `${NEMWEB_ARCHIVE_BASE}/PUBLIC_DISPATCH_${norm}.zip`;
}

/**
 * Discover zip URLs for a date. Archive has one zip per day.
 * For current reports (5-min intervals), multiple zips would be needed - not implemented.
 */
export async function discoverAemoZipUrlsForDate(dateStr: string): Promise<string[]> {
  const url = getAemoArchiveZipUrlForDate(dateStr);
  const res = await fetch(url, { method: 'HEAD' });
  if (res.ok) {
    return [url];
  }
  return [];
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

export interface FetchAemoDailyResult {
  written: number;
  errors: string[];
}

/**
 * Fetch AEMO daily average RRP for one or more regions/dates.
 * indexId format: {region}_daily_rrp_{date} e.g. NSW1_daily_rrp_2026-03-20
 */
export async function fetchAemoDailyForRegionDate(
  region: string,
  dateStr: string,
  zipUrls: string[],
  dataDir: string
): Promise<FetchAemoDailyResult> {
  const result: FetchAemoDailyResult = { written: 0, errors: [] };

  if (zipUrls.length === 0) {
    result.errors.push(`No zip URLs for date=${dateStr}`);
    return result;
  }

  let allRows: ReturnType<typeof parseDispatchCsv> = [];
  for (const url of zipUrls) {
    try {
      const zipBuf = await fetchZip(url);
      const zip = new AdmZip(Buffer.from(zipBuf));
      const csv = extractCsvFromZip(zip);
      if (csv) {
        const rows = parseDispatchCsv(csv);
        allRows = allRows.concat(rows);
      }
    } catch (err) {
      result.errors.push(`Zip fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return result;
    }
  }

  const dateNorm = dateStr.slice(0, 10);
  const avg = extractDailyAverageRRP(allRows, region, dateNorm);
  if (avg == null) {
    result.errors.push(`No data for region=${region} date=${dateNorm}`);
    return result;
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const indexId = `${region}_daily_rrp_${dateNorm}`;
  const outPath = path.join(dataDir, `${indexId}.json`);
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
  result.written = 1;

  return result;
}

/**
 * Fetch AEMO daily RRP for multiple regions on the same date.
 */
export async function fetchAemoDailyForRegionsAndDate(
  regions: string[],
  dateStr: string,
  zipUrls: string[],
  dataDir: string
): Promise<FetchAemoDailyResult> {
  const combined: FetchAemoDailyResult = { written: 0, errors: [] };

  if (zipUrls.length === 0) {
    const urls = await discoverAemoZipUrlsForDate(dateStr);
    if (urls.length === 0) {
      combined.errors.push(`No zip URLs for date=${dateStr}`);
      return combined;
    }
    zipUrls = urls;
  }

  let allRows: ReturnType<typeof parseDispatchCsv> = [];
  for (const url of zipUrls) {
    try {
      const zipBuf = await fetchZip(url);
      const zip = new AdmZip(Buffer.from(zipBuf));
      const csv = extractCsvFromZip(zip);
      if (csv) {
        const rows = parseDispatchCsv(csv);
        allRows = allRows.concat(rows);
      }
    } catch (err) {
      combined.errors.push(`Zip fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return combined;
    }
  }

  const dateNorm = dateStr.slice(0, 10);
  const regionList = regions.length > 0 ? regions : [...NEM_REGIONS];

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  for (const region of regionList) {
    const avg = extractDailyAverageRRP(allRows, region, dateNorm);
    if (avg == null) {
      combined.errors.push(`No data for region=${region} date=${dateNorm}`);
      continue;
    }

    const indexId = `${region}_daily_rrp_${dateNorm}`;
    const outPath = path.join(dataDir, `${indexId}.json`);
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
    combined.written++;
  }

  return combined;
}
