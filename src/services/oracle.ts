import { WeatherOracle, OracleResult } from '../domain/oracle';
import { Market, MarketId } from '../domain/market';
import { Outcome } from '../domain/types';

/**
 * Mock weather oracle for development and testing
 * In production, this would connect to NOAA API or similar
 */
export class MockWeatherOracle implements WeatherOracle {
  /**
   * Mock implementation that returns deterministic values based on location and date
   */
  async fetchWeatherData(market: {
    location: string;
    eventDate: Date;
    condition: string;
  }): Promise<number> {
    // Simple mock: hash location + date to get a deterministic value
    const hash = this.simpleHash(
      `${market.location}_${market.eventDate.toISOString()}`
    );
    
    // Return a value between 0 and 20 (e.g., mm of rainfall)
    return (hash % 2000) / 100;
  }

  /**
   * Determine outcome based on condition and value
   * Parses simple conditions like "rainfall >= 5mm"
   */
  determineOutcome(condition: string, value: number): Outcome {
    // Simple parser for conditions like "rainfall >= 5mm" or "temperature < 0"
    const match = condition.match(/(\w+)\s*(>=|<=|>|<|==)\s*([\d.]+)/);
    if (!match) {
      throw new Error(`Unable to parse condition: ${condition}`);
    }

    const [, , operator, thresholdStr] = match;
    const threshold = parseFloat(thresholdStr);

    let result: boolean;
    switch (operator) {
      case '>=':
        result = value >= threshold;
        break;
      case '<=':
        result = value <= threshold;
        break;
      case '>':
        result = value > threshold;
        break;
      case '<':
        result = value < threshold;
        break;
      case '==':
        result = value === threshold;
        break;
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }

    return result ? Outcome.YES : Outcome.NO;
  }

  /**
   * Simple hash function for deterministic mock values
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

/**
 * Oracle service that wraps the weather oracle and records results
 */
export class OracleService {
  constructor(private oracle: WeatherOracle) {}

  /**
   * Resolve a market using the oracle
   * Returns the oracle result (immutable once recorded)
   */
  async resolveMarket(market: Market): Promise<OracleResult> {
    const value = await this.oracle.fetchWeatherData({
      location: market.location,
      eventDate: market.eventDate,
      condition: market.condition,
    });

    const outcome = this.oracle.determineOutcome(market.condition, value);

    return {
      marketId: market.id,
      outcome,
      value,
      recordedAt: new Date(),
      source: 'mock', // In production, this would be "noaa" or similar
      metadata: {
        location: market.location,
        eventDate: market.eventDate.toISOString(),
        condition: market.condition,
      },
    };
  }
}

