import { MarketType } from '../domain/types';
import { isFuturesMarket } from './futuresMatchingGuard';

describe('futuresMatchingGuard', () => {
  /**
   * Ensures we always use the OSS matching engine for any market that has
   * indexType (climate weeklies) or marketType FUTURES. If this is relaxed,
   * futures could accidentally use the binary engine and matching would break.
   */
  it('returns true when marketType is FUTURES', () => {
    expect(isFuturesMarket({ marketType: MarketType.FUTURES })).toBe(true);
    expect(isFuturesMarket({ marketType: MarketType.FUTURES, indexType: null })).toBe(true);
  });

  it('returns true when indexType is set (climate weeklies)', () => {
    expect(isFuturesMarket({ indexType: 'weather_rainfall' })).toBe(true);
    expect(isFuturesMarket({ marketType: 'BINARY' as MarketType, indexType: 'temperature_high' })).toBe(true);
    expect(isFuturesMarket({ indexType: 'solar_exposure' })).toBe(true);
  });

  it('returns true when both marketType FUTURES and indexType set', () => {
    expect(isFuturesMarket({ marketType: MarketType.FUTURES, indexType: 'wind_gust_max' })).toBe(true);
  });

  it('returns false when marketType is BINARY and no indexType', () => {
    expect(isFuturesMarket({ marketType: MarketType.BINARY })).toBe(false);
    expect(isFuturesMarket({ marketType: MarketType.BINARY, indexType: null })).toBe(false);
  });

  it('returns false when indexType is empty string', () => {
    expect(isFuturesMarket({ indexType: '' })).toBe(false);
  });

  it('returns false when market is empty or undefined type', () => {
    expect(isFuturesMarket({})).toBe(false);
    expect(isFuturesMarket({ marketType: undefined, indexType: undefined })).toBe(false);
  });
});
