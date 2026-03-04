/**
 * Oracle config: maps seeded BOM climate markets to data source parameters.
 * Reuses stations and index types from src/data/bomStations.ts.
 */

import {
  BOM_RAINFALL_STATIONS,
  CLIMATE_WEEKLY_INDEX_TYPES,
  formatDateKey,
  getWeekEnding,
} from '../../data/bomStations';
import { IndexType } from '../../domain/types';

/** BOM product ID by state (regional FWO observations) */
export const BOM_PRODUCT_BY_STATE: Record<string, string> = {
  NSW: 'IDN60801',
  ACT: 'IDN60801',
  VIC: 'IDV60801',
  QLD: 'IDQ60801',
  WA: 'IDW60801',
  SA: 'IDS60801',
  TAS: 'IDT60801',
  NT: 'IDD60801',
};

/** BOM metric key and aggregation for each index type */
export interface BomMetricConfig {
  /** BOM field name for daily values (or logical key for parser) */
  bomField: string;
  /** Aggregation across the week: sum | max | min */
  aggregate: 'sum' | 'max' | 'min';
  /** Multiplier for payouts (from seed script) */
  multiplier: number;
}

export const INDEX_TO_BOM_METRIC: Record<string, BomMetricConfig> = {
  [IndexType.WEATHER_RAINFALL]: {
    bomField: 'rainfall_mm',
    aggregate: 'sum',
    multiplier: 0.02,
  },
  [IndexType.TEMPERATURE_HIGH]: {
    bomField: 'max_temp',
    aggregate: 'max',
    multiplier: 0.02,
  },
  [IndexType.TEMPERATURE_LOW]: {
    bomField: 'min_temp',
    aggregate: 'min',
    multiplier: 0.02,
  },
  [IndexType.WIND_GUST_MAX]: {
    bomField: 'wind_gust_kmh',
    aggregate: 'max',
    multiplier: 0.01,
  },
  [IndexType.SOLAR_EXPOSURE]: {
    bomField: 'solar_mj',
    aggregate: 'sum',
    multiplier: 0.002,
  },
};

export interface BomMarketMapping {
  indexId: string;
  stationId: string;
  productId: string;
  indexType: string;
  metric: BomMetricConfig;
  weekEndStr: string;
}

/**
 * Generate all BOM market mappings (station × index type × week ending).
 * Matches seed script structure: indexId = {stationId}_{indexType}_{weekEndStr}
 */
export function getBomMarketMappings(
  weekEndings: Date[]
): BomMarketMapping[] {
  const result: BomMarketMapping[] = [];
  for (const station of BOM_RAINFALL_STATIONS) {
    const productId = BOM_PRODUCT_BY_STATE[station.state] ?? 'IDN60801';
    for (const weekEnd of weekEndings) {
      const weekEndStr = formatDateKey(weekEnd);
      for (const { indexType } of CLIMATE_WEEKLY_INDEX_TYPES) {
        const metric = INDEX_TO_BOM_METRIC[indexType];
        if (!metric) continue;
        result.push({
          indexId: `${station.id}_${indexType}_${weekEndStr}`,
          stationId: station.id,
          productId,
          indexType,
          metric,
          weekEndStr,
        });
      }
    }
  }
  return result;
}

/** Re-export for fetch script */
export { getWeekEnding, formatDateKey } from '../../data/bomStations';
