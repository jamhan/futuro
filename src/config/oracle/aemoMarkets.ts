/**
 * Oracle config: maps energy markets to AEMO NEM regions and intervals.
 * Used by fetch-dispatch-price.ts. Current seed creates only BOM markets;
 * this config prepares for future energy market seeding.
 */

export interface AemoMarketConfig {
  marketId: string;
  region: string; // NEM region: NSW1, QLD1, VIC1, SA1, TAS1
  interval: string; // ISO string e.g. "2026-03-20T18:00:00+11:00"
  multiplier: number;
}

/** NEM region IDs for dispatch data */
export const NEM_REGIONS = ['NSW1', 'QLD1', 'VIC1', 'SA1', 'TAS1'] as const;

/**
 * Energy market configs. Extend when energy markets are seeded.
 * Example:
 * { marketId: "NSW_CAP_20260320_1800", region: "NSW1", interval: "2026-03-20T18:00:00+11:00", multiplier: 0.0033 }
 */
export const AEMO_MARKET_CONFIGS: AemoMarketConfig[] = [
  // Placeholder - add entries when energy markets exist
];
