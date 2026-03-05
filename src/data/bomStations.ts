import { IndexType } from '../domain/types';

/**
 * Bureau of Meteorology (BoM) climate stations for weekly predictions.
 * Data source: https://www.bom.gov.au/climate/data/
 * Station list: http://www.bom.gov.au/climate/data/lists_by_element/stations.txt
 */

export interface BomStation {
  /** BoM 6-digit station number (zero-padded) */
  id: string;
  /** Station name / location */
  name: string;
  /** Australian state/territory */
  state: string;
  /** Short location for market description */
  location: string;
}

/** Climate weekly index types: one market per (station, week, type) */
export interface ClimateWeeklyIndexType {
  indexType: IndexType;
  label: string;
  unit: string;
  /** Short definition for market description: what the index measures and source */
  definition: string;
}

export const CLIMATE_WEEKLY_INDEX_TYPES: ClimateWeeklyIndexType[] = [
  {
    indexType: IndexType.WEATHER_RAINFALL,
    label: 'Rainfall',
    unit: 'mm',
    definition: 'Total rainfall from Bureau of Meteorology',
  },
  {
    indexType: IndexType.TEMPERATURE_HIGH,
    label: 'Temperature high',
    unit: '°C',
    definition: 'Maximum temperature for the week (BoM)',
  },
  {
    indexType: IndexType.TEMPERATURE_LOW,
    label: 'Temperature low',
    unit: '°C',
    definition: 'Minimum temperature for the week (BoM)',
  },
  {
    indexType: IndexType.WIND_GUST_MAX,
    label: 'Max wind gust',
    unit: 'km/h',
    definition: 'Maximum wind gust for the week (BoM)',
  },
  {
    indexType: IndexType.SOLAR_EXPOSURE,
    label: 'Solar exposure',
    unit: 'MJ/m²',
    definition: 'Total solar exposure for the week (BoM)',
  },
];

/**
 * Curated list of major capital-city climate stations (BoM Climate Data Online).
 */
export const BOM_RAINFALL_STATIONS: BomStation[] = [
  { id: '066062', name: 'Sydney Observatory Hill', state: 'NSW', location: 'Sydney, NSW' },
  { id: '086338', name: 'Melbourne (Olympic Park)', state: 'VIC', location: 'Melbourne, VIC' },
  { id: '040842', name: 'Brisbane Aero', state: 'QLD', location: 'Brisbane, QLD' },
  { id: '009021', name: 'Perth Airport', state: 'WA', location: 'Perth, WA' },
  { id: '023034', name: 'Adelaide Airport', state: 'SA', location: 'Adelaide, SA' },
  { id: '014015', name: 'Darwin Airport', state: 'NT', location: 'Darwin, NT' },
  { id: '094029', name: 'Hobart (Ellerslie Road)', state: 'TAS', location: 'Hobart, TAS' },
  { id: '070351', name: 'Canberra Airport', state: 'ACT', location: 'Canberra, ACT' },
];

/**
 * Get week ending date (Sunday) for a given date.
 * Week runs Monday–Sunday; returns the Sunday of that week.
 */
export function getWeekEnding(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysToSunday = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + daysToSunday);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Format date as YYYY-MM-DD for indexId
 */
export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Generate week-ending dates for the next N weeks from a reference date.
 * Includes the week containing referenceDate (its Sunday) then N-1 following weeks.
 */
export function getUpcomingWeekEndings(referenceDate: Date, numWeeks: number): Date[] {
  const results: Date[] = [];
  const firstWeekEnd = getWeekEnding(referenceDate);
  const firstWeekEndTime = firstWeekEnd.getTime();
  for (let i = 0; i < numWeeks; i++) {
    const we = new Date(firstWeekEndTime + i * 7 * 24 * 60 * 60 * 1000);
    results.push(we);
  }
  return results;
}

/**
 * Next N days starting from tomorrow (excludes today).
 */
export function getUpcomingDays(referenceDate: Date, numDays: number): Date[] {
  const results: Date[] = [];
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1); // start tomorrow
  for (let i = 0; i < numDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    d.setHours(23, 59, 59, 999);
    results.push(d);
  }
  return results;
}

/**
 * Last day of the next N months from a reference date.
 */
export function getUpcomingMonthEndings(referenceDate: Date, numMonths: number): Date[] {
  const results: Date[] = [];
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  for (let i = 0; i < numMonths; i++) {
    const month = new Date(d.getFullYear(), d.getMonth() + i + 1, 0);
    month.setHours(23, 59, 59, 999);
    results.push(month);
  }
  return results;
}
