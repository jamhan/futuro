import { Outcome, MarketId } from './types';

/**
 * OracleResult represents the resolution of a market
 * Once recorded, this is immutable and auditable
 */
export interface OracleResult {
  marketId: MarketId;
  outcome: Outcome;
  value: number; // Actual measured value (e.g., 7.5mm rainfall)
  recordedAt: Date;
  source: string; // e.g., "NOAA", "mock", "manual"
  metadata?: Record<string, unknown>; // Additional context
}

/**
 * WeatherOracle interface for fetching weather data
 * Abstracted to allow different implementations (mock, NOAA API, etc.)
 */
export interface WeatherOracle {
  /**
   * Fetch weather data for a market
   * Returns the actual measured value
   */
  fetchWeatherData(market: {
    location: string;
    eventDate: Date;
    condition: string;
  }): Promise<number>;

  /**
   * Determine outcome based on condition and value
   * Example: condition "rainfall >= 5mm", value 7.5 -> YES
   */
  determineOutcome(condition: string, value: number): Outcome;
}

