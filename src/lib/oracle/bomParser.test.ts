import {
  parseBomJson,
  aggregateWeekly,
  getWeekBounds,
} from './bomParser';
import type { BomMetricConfig } from '../../config/oracle/bomStations';

describe('bomParser', () => {
  const sampleBomJson = {
    observations: {
      data: [
        {
          local_date_time_full: '20260317000000',
          date: '2026-03-17',
          rainfall: 2.5,
          max_temp: 24.1,
          min_temp: 12.0,
          gust_kmh: 35,
          daily_global_solar_exposure: 18.2,
        },
        {
          local_date_time_full: '20260318000000',
          rainfall: 0,
          max_temp: 25.0,
          min_temp: 11.5,
          gust_kmh: 28,
          daily_global_solar_exposure: 19.0,
        },
        {
          local_date_time_full: '20260320000000',
          rainfall: 10.0,
          max_temp: 22.0,
          min_temp: 14.0,
          gust_kmh: 45,
          daily_global_solar_exposure: 12.5,
        },
      ],
    },
  };

  describe('parseBomJson', () => {
    it('extracts daily records from observations.data', () => {
      const records = parseBomJson(sampleBomJson);
      expect(records).toHaveLength(3);
      expect(records[0].date).toBe('2026-03-17');
      expect(records[1].date).toBe('2026-03-18');
      expect(records[2].date).toBe('2026-03-20');
      expect(records[0].rainfall).toBe(2.5);
      expect(records[0].max_temp).toBe(24.1);
    });

    it('handles alternative structure with data at root', () => {
      const alt = { data: [{ date: '2026-03-17', rainfall: 5 }] };
      const records = parseBomJson(alt);
      expect(records).toHaveLength(1);
      expect(records[0].date).toBe('2026-03-17');
    });

    it('returns empty array for invalid input', () => {
      expect(parseBomJson(null)).toEqual([]);
      expect(parseBomJson({})).toEqual([]);
    });
  });

  describe('aggregateWeekly', () => {
    const records = parseBomJson(sampleBomJson);
    const { weekStart, weekEnd } = getWeekBounds('2026-03-23');

    it('sums rainfall', () => {
      const metric: BomMetricConfig = {
        bomField: 'rainfall_mm',
        aggregate: 'sum',
        multiplier: 0.02,
      };
      const val = aggregateWeekly(records, metric, weekStart, weekEnd);
      expect(val).toBe(2.5 + 0 + 10); // 12.5
    });

    it('takes max for max_temp', () => {
      const metric: BomMetricConfig = {
        bomField: 'max_temp',
        aggregate: 'max',
        multiplier: 0.02,
      };
      const val = aggregateWeekly(records, metric, weekStart, weekEnd);
      expect(val).toBe(25.0);
    });

    it('takes min for min_temp', () => {
      const metric: BomMetricConfig = {
        bomField: 'min_temp',
        aggregate: 'min',
        multiplier: 0.02,
      };
      const val = aggregateWeekly(records, metric, weekStart, weekEnd);
      expect(val).toBe(11.5);
    });

    it('uses field aliases (gust_kmh)', () => {
      const metric: BomMetricConfig = {
        bomField: 'wind_gust_kmh',
        aggregate: 'max',
        multiplier: 0.01,
      };
      const val = aggregateWeekly(records, metric, weekStart, weekEnd);
      expect(val).toBe(45);
    });

    it('returns null when no records in window', () => {
      const metric: BomMetricConfig = {
        bomField: 'rainfall_mm',
        aggregate: 'sum',
        multiplier: 0.02,
      };
      const val = aggregateWeekly(records, metric, '2030-01-01', '2030-01-07');
      expect(val).toBeNull();
    });
  });

  describe('getWeekBounds', () => {
    it('returns Mon–Sun for week ending 2026-03-23', () => {
      const { weekStart, weekEnd } = getWeekBounds('2026-03-23');
      expect(weekStart).toBe('2026-03-17'); // Monday
      expect(weekEnd).toBe('2026-03-23'); // Sunday
    });
  });
});
