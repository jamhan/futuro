import { Market } from '../domain/market';
import { IndexType } from '../domain/types';

/**
 * Index provider: returns settlement index value for a futures market.
 * Used when resolving if no manual indexValue is provided.
 */
export interface IndexProvider {
  getIndexValue(market: Market): Promise<number>;
}

function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Mock index: deterministic value from indexId + eventDate, scaled to a range
 */
function mockValue(market: Market, max: number, decimals = 1): number {
  const key = `${market.indexType}_${market.indexId ?? 'default'}_${market.eventDate.getTime()}`;
  return (hashKey(key) % (max * Math.pow(10, decimals))) / Math.pow(10, decimals);
}

export class MockWeatherIndexProvider implements IndexProvider {
  async getIndexValue(market: Market): Promise<number> {
    return mockValue(market, 150, 1); // 0–150 mm
  }
}

export class MockSolarIndexProvider implements IndexProvider {
  async getIndexValue(market: Market): Promise<number> {
    return mockValue(market, 30, 1); // 0–30 kWh/m² (legacy)
  }
}

/** Mock temperature high (°C): e.g. 15–40 */
export class MockTemperatureHighProvider implements IndexProvider {
  async getIndexValue(market: Market): Promise<number> {
    return 15 + (hashKey(`${market.indexId}_${market.eventDate.getTime()}`) % 250) / 10;
  }
}

/** Mock temperature low (°C): e.g. 0–25 */
export class MockTemperatureLowProvider implements IndexProvider {
  async getIndexValue(market: Market): Promise<number> {
    return (hashKey(`${market.indexId}_${market.eventDate.getTime()}`) % 250) / 10;
  }
}

/** Mock max wind gust (km/h): e.g. 20–120 */
export class MockWindGustMaxProvider implements IndexProvider {
  async getIndexValue(market: Market): Promise<number> {
    return 20 + (hashKey(`${market.indexId}_${market.eventDate.getTime()}`) % 1000) / 10;
  }
}

/** Mock weekly solar exposure (MJ/m²): sum of daily, e.g. 50–350 */
export class MockSolarExposureProvider implements IndexProvider {
  async getIndexValue(market: Market): Promise<number> {
    return 50 + (hashKey(`${market.indexId}_${market.eventDate.getTime()}`) % 3000) / 10;
  }
}

const providers: Partial<Record<IndexType, IndexProvider>> = {
  [IndexType.WEATHER_RAINFALL]: new MockWeatherIndexProvider(),
  [IndexType.SOLAR_GHI]: new MockSolarIndexProvider(),
  [IndexType.TEMPERATURE_HIGH]: new MockTemperatureHighProvider(),
  [IndexType.TEMPERATURE_LOW]: new MockTemperatureLowProvider(),
  [IndexType.WIND_GUST_MAX]: new MockWindGustMaxProvider(),
  [IndexType.SOLAR_EXPOSURE]: new MockSolarExposureProvider(),
};

/**
 * Get index value for a futures market (mock or override)
 */
export async function getIndexValueForMarket(
  market: Market,
  manualOverride?: number
): Promise<number> {
  if (manualOverride != null) {
    return manualOverride;
  }
  const provider = market.indexType ? providers[market.indexType as IndexType] : undefined;
  if (provider) {
    return provider.getIndexValue(market);
  }
  throw new Error(`Unknown index type: ${market.indexType}`);
}
