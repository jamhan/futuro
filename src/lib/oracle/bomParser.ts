/**
 * Parse BOM (Bureau of Meteorology) observation JSON and extract/aggregate values.
 * BOM daily data is aggregated to weekly (Mon–Sun) to match market seeding.
 */

import type { BomMetricConfig } from '../../config/oracle/bomStations';

/** Daily observation record - field names may vary by BOM product */
export interface BomDailyRecord {
  date: string; // YYYY-MM-DD
  [key: string]: unknown;
}

/** Field name mapping: our metric key → possible BOM field names */
const BOM_FIELD_ALIASES: Record<string, string[]> = {
  rainfall_mm: ['rainfall', 'rain_trace', 'rainfall_amount', 'precipitation'],
  max_temp: ['air_temperature_maximum', 'max_temp', 'maximum_temperature', 'temp_max'],
  min_temp: ['air_temperature_minimum', 'min_temp', 'minimum_temperature', 'temp_min'],
  wind_gust_kmh: ['gust_kmh', 'gust_wind_speed', 'wind_gust', 'max_wind_gust'],
  solar_mj: ['daily_global_solar_exposure', 'solar_exposure', 'solar_mj', 'radiation'],
};

function extractNumericValue(record: BomDailyRecord, bomField: string): number | null {
  const aliases = BOM_FIELD_ALIASES[bomField] ?? [bomField];
  for (const key of aliases) {
    const val = record[key];
    if (val != null && val !== '' && val !== '-') {
      const n = typeof val === 'number' ? val : parseFloat(String(val));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

/**
 * Parse BOM JSON and return daily records.
 * Expects structure: { observations: { data: [...] } } or { data: [...] }
 * Each record must have a parseable date (date, local_date_time_full, etc).
 */
export function parseBomJson(json: unknown): BomDailyRecord[] {
  const data = extractDataArray(json);
  const records: BomDailyRecord[] = [];

  for (const row of data) {
    const date = parseDateFromRecord(row);
    if (!date) continue;

    const record: BomDailyRecord = { date, ...row };
    records.push(record);
  }

  return records;
}

function extractDataArray(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  const obs = obj.observations as Record<string, unknown> | undefined;
  const data = obs?.data ?? (obj.data as unknown[] | undefined);
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

function parseDateFromRecord(row: Record<string, unknown>): string | null {
  const full = row.local_date_time_full ?? row.date;
  if (typeof full === 'string') {
    // YYYYMMDDHHMMSS or YYYY-MM-DD
    if (full.length >= 8) {
      return full.includes('-')
        ? full.slice(0, 10)
        : `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}`;
    }
  }
  return null;
}

/**
 * Aggregate daily values to a weekly value (Mon–Sun) for the given metric.
 * weekStart and weekEnd are the Monday and Sunday of the week (YYYY-MM-DD).
 */
export function aggregateWeekly(
  records: BomDailyRecord[],
  metric: BomMetricConfig,
  weekStart: string,
  weekEnd: string
): number | null {
  const values: number[] = [];
  for (const r of records) {
    if (r.date >= weekStart && r.date <= weekEnd) {
      const v = extractNumericValue(r, metric.bomField);
      if (v != null) values.push(v);
    }
  }
  if (values.length === 0) return null;

  switch (metric.aggregate) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    default:
      return null;
  }
}

/**
 * Get week bounds (Monday and Sunday) for a week-ending date (YYYY-MM-DD).
 */
export function getWeekBounds(weekEndStr: string): { weekStart: string; weekEnd: string } {
  const [y, m, d] = weekEndStr.split('-').map(Number);
  const sunday = new Date(y, m - 1, d);
  const monday = new Date(sunday);
  monday.setDate(monday.getDate() - 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    weekStart: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
    weekEnd: weekEndStr,
  };
}
