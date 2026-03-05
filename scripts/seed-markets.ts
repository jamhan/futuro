/**
 * Seed weather (BOM) and AEMO electricity markets.
 * Creates: next 2 days, next 2 weekly averages, next 2 monthly averages
 * for all weather stations × index types, and all NEM regions.
 *
 * Run: npm run seed:markets
 * Clears all existing markets first.
 */

import { PrismaClient } from '@prisma/client';
import { MarketState } from '../src/domain/types';
import {
  BOM_RAINFALL_STATIONS,
  CLIMATE_WEEKLY_INDEX_TYPES,
  formatDateKey,
  getUpcomingDays,
  getUpcomingWeekEndings,
  getUpcomingMonthEndings,
} from '../src/data/bomStations';
import { NEM_REGIONS } from '../src/config/oracle/aemoMarkets';
import { IndexType } from '../src/domain/types';

const prisma = new PrismaClient();

// Resolution and data source text for descriptions
const BOM_RESOLUTION =
  'Resolution: Bureau of Meteorology Climate Data Online (observed values).';
const BOM_DATA_SOURCE =
  'Data: https://www.bom.gov.au/climate/data/ (product IDs by state, e.g. IDN60801 for NSW).';
const AEMO_RESOLUTION =
  'Resolution: AEMO NEMweb Dispatch reports (arithmetic mean of five-minute RRP intervals).';
const AEMO_DATA_SOURCE =
  'Data: https://www.nemweb.com.au/Reports/Current/Dispatch_Reports/ or Archive.';

/** Adapt definition for period: "for the week" -> "for the day/week/month" */
function definitionForPeriod(definition: string, period: 'daily' | 'weekly' | 'monthly'): string {
  const periodPhrase = period === 'daily' ? 'for that day' : period === 'weekly' ? 'for the week (Mon–Sun)' : 'for the month';
  if (definition.includes('for the week')) {
    return definition.replace(/\bfor the week\b/gi, periodPhrase);
  }
  // Rainfall etc. don't specify period; add it
  return definition.replace(/^(Total \w+)( from | \()/i, `$1 ${periodPhrase}$2`);
}

// What each weather metric settles to (by period)
const WEATHER_SETTLEMENT: Record<
  string,
  { daily: string; weekly: string; monthly: string }
> = {
  [IndexType.WEATHER_RAINFALL]: {
    daily: 'Settles to total rainfall (mm) for that day.',
    weekly: 'Settles to total rainfall (mm) for the week (Mon–Sun).',
    monthly: 'Settles to total rainfall (mm) for the month.',
  },
  [IndexType.TEMPERATURE_HIGH]: {
    daily: 'Settles to maximum temperature (°C) for that day.',
    weekly: 'Settles to max of daily maximum temperatures for the week (Mon–Sun).',
    monthly: 'Settles to max of daily maximum temperatures for the month.',
  },
  [IndexType.TEMPERATURE_LOW]: {
    daily: 'Settles to minimum temperature (°C) for that day.',
    weekly: 'Settles to min of daily minimum temperatures for the week (Mon–Sun).',
    monthly: 'Settles to min of daily minimum temperatures for the month.',
  },
  [IndexType.WIND_GUST_MAX]: {
    daily: 'Settles to maximum wind gust (km/h) for that day.',
    weekly: 'Settles to max wind gust (km/h) for the week (Mon–Sun).',
    monthly: 'Settles to max wind gust (km/h) for the month.',
  },
  [IndexType.SOLAR_EXPOSURE]: {
    daily: 'Settles to total solar exposure (MJ/m²) for that day.',
    weekly: 'Settles to total solar exposure (MJ/m²) for the week (Mon–Sun).',
    monthly: 'Settles to total solar exposure (MJ/m²) for the month.',
  },
  [IndexType.SOLAR_GHI]: {
    daily: 'Settles to GHI value for that day.',
    weekly: 'Settles to GHI aggregate for the week (Mon–Sun).',
    monthly: 'Settles to GHI aggregate for the month.',
  },
};

const WEATHER_PRICE_BOUNDS: Record<string, { min: number; max: number }> = {
  [IndexType.WEATHER_RAINFALL]: { min: 0, max: 500 },
  [IndexType.TEMPERATURE_HIGH]: { min: 0, max: 50 },
  [IndexType.TEMPERATURE_LOW]: { min: -10, max: 40 },
  [IndexType.WIND_GUST_MAX]: { min: 0, max: 200 },
  [IndexType.SOLAR_EXPOSURE]: { min: 0, max: 500 },
  [IndexType.SOLAR_GHI]: { min: 0, max: 30 },
};

const WEATHER_MULTIPLIERS: Record<string, number> = {
  [IndexType.WEATHER_RAINFALL]: 0.02,
  [IndexType.TEMPERATURE_HIGH]: 0.02,
  [IndexType.TEMPERATURE_LOW]: 0.02,
  [IndexType.WIND_GUST_MAX]: 0.01,
  [IndexType.SOLAR_EXPOSURE]: 0.002,
  [IndexType.SOLAR_GHI]: 0.03,
};

const AEMO_PRICE_BOUNDS = { min: -500, max: 2000 };
const AEMO_MULTIPLIER = 0.01;

const REGION_LABELS: Record<string, string> = {
  NSW1: 'NSW',
  QLD1: 'Queensland',
  VIC1: 'Victoria',
  SA1: 'South Australia',
  TAS1: 'Tasmania',
};

async function main() {
  const fromDate = new Date();

  console.log('Clearing all existing markets...');
  const deleted = await prisma.market.deleteMany({});
  console.log(`Deleted ${deleted.count} markets.`);

  let weatherCreated = 0;
  let aemoCreated = 0;

  // --- Weather markets: 2 daily, 2 weekly, 2 monthly ---
  const dailyDates = getUpcomingDays(fromDate, 2);
  const weekEndings = getUpcomingWeekEndings(fromDate, 2);
  const monthEndings = getUpcomingMonthEndings(fromDate, 2);

  for (const station of BOM_RAINFALL_STATIONS) {
    for (const { indexType, definition, unit } of CLIMATE_WEEKLY_INDEX_TYPES) {
      const bounds = WEATHER_PRICE_BOUNDS[indexType] ?? { min: 0, max: 1000 };
      const contractMultiplier = WEATHER_MULTIPLIERS[indexType] ?? 1;

      // Daily — day ending
      const settlement = WEATHER_SETTLEMENT[indexType] ?? {
        daily: 'Settles to observed value for that day.',
        weekly: 'Settles to aggregate for the week (Mon–Sun).',
        monthly: 'Settles to aggregate for the month.',
      };
      for (const date of dailyDates) {
        const dateStr = formatDateKey(date);
        const indexId = `${station.id}_${indexType}_daily_${dateStr}`;
        const desc = definitionForPeriod(definition, 'daily');
        const description = `${station.location}: ${desc} (${unit}). Day ending ${dateStr}. ${settlement.daily} ${BOM_RESOLUTION} ${BOM_DATA_SOURCE}`;
        await prisma.market.create({
          data: {
            description,
            location: station.location,
            eventDate: date,
            condition: `daily_${indexType}`,
            state: MarketState.OPEN,
            marketType: 'FUTURES',
            indexType,
            indexId,
            minPrice: bounds.min,
            maxPrice: bounds.max,
            correlationGroupId: `${indexType}_daily_${dateStr}`,
            contractMultiplier,
          },
        });
        weatherCreated++;
      }

      // Weekly — week ending (Mon–Sun)
      for (const weekEnd of weekEndings) {
        const weekEndStr = formatDateKey(weekEnd);
        const indexId = `${station.id}_${indexType}_${weekEndStr}`;
        const desc = definitionForPeriod(definition, 'weekly');
        const description = `${station.location}: ${desc} (${unit}). Week ending ${weekEndStr}. ${settlement.weekly} ${BOM_RESOLUTION} ${BOM_DATA_SOURCE}`;
        await prisma.market.create({
          data: {
            description,
            location: station.location,
            eventDate: weekEnd,
            condition: `weekly_${indexType}`,
            state: MarketState.OPEN,
            marketType: 'FUTURES',
            indexType,
            indexId,
            minPrice: bounds.min,
            maxPrice: bounds.max,
            correlationGroupId: `${indexType}_${weekEndStr}`,
            contractMultiplier,
          },
        });
        weatherCreated++;
      }

      // Monthly — month ending
      for (const monthEnd of monthEndings) {
        const monthStr = formatDateKey(monthEnd).slice(0, 7); // YYYY-MM
        const indexId = `${station.id}_${indexType}_monthly_${monthStr}`;
        const desc = definitionForPeriod(definition, 'monthly');
        const description = `${station.location}: ${desc} (${unit}). Month ending ${monthStr}. ${settlement.monthly} ${BOM_RESOLUTION} ${BOM_DATA_SOURCE}`;
        await prisma.market.create({
          data: {
            description,
            location: station.location,
            eventDate: monthEnd,
            condition: `monthly_${indexType}`,
            state: MarketState.OPEN,
            marketType: 'FUTURES',
            indexType,
            indexId,
            minPrice: bounds.min,
            maxPrice: bounds.max,
            correlationGroupId: `${indexType}_monthly_${monthStr}`,
            contractMultiplier,
          },
        });
        weatherCreated++;
      }
    }
  }

  // --- AEMO electricity markets: 2 daily, 2 weekly, 2 monthly ---
  for (const region of NEM_REGIONS) {
    const regionLabel = REGION_LABELS[region] ?? region;

    for (const date of dailyDates) {
      const dateStr = formatDateKey(date);
      const indexId = `${region}_daily_rrp_${dateStr}`;
      await prisma.market.create({
        data: {
          description: `${regionLabel}: Daily average RRP ($/MWh). Day ending ${dateStr}. Settles to arithmetic mean of 288 five-minute Regional Reference Prices for that day. ${AEMO_RESOLUTION} ${AEMO_DATA_SOURCE}`,
          location: region,
          eventDate: new Date(dateStr + 'T23:59:59Z'),
          condition: 'daily_avg_rrp',
          state: MarketState.OPEN,
          marketType: 'FUTURES',
          indexType: IndexType.DISPATCH_DAILY_RRP,
          indexId,
          minPrice: AEMO_PRICE_BOUNDS.min,
          maxPrice: AEMO_PRICE_BOUNDS.max,
          correlationGroupId: `daily_rrp_${dateStr}`,
          contractMultiplier: AEMO_MULTIPLIER,
        },
      });
      aemoCreated++;
    }

    for (const weekEnd of weekEndings) {
      const weekEndStr = formatDateKey(weekEnd);
      const indexId = `${region}_weekly_rrp_${weekEndStr}`;
      await prisma.market.create({
        data: {
          description: `${regionLabel}: Weekly average RRP ($/MWh). Week ending ${weekEndStr}. Settles to average of daily average RRPs for the week (Mon–Sun). ${AEMO_RESOLUTION} ${AEMO_DATA_SOURCE}`,
          location: region,
          eventDate: new Date(weekEndStr + 'T23:59:59Z'),
          condition: 'weekly_avg_rrp',
          state: MarketState.OPEN,
          marketType: 'FUTURES',
          indexType: IndexType.DISPATCH_DAILY_RRP,
          indexId,
          minPrice: AEMO_PRICE_BOUNDS.min,
          maxPrice: AEMO_PRICE_BOUNDS.max,
          correlationGroupId: `weekly_rrp_${weekEndStr}`,
          contractMultiplier: AEMO_MULTIPLIER,
        },
      });
      aemoCreated++;
    }

    for (const monthEnd of monthEndings) {
      const monthStr = formatDateKey(monthEnd).slice(0, 7);
      const indexId = `${region}_monthly_rrp_${monthStr}`;
      await prisma.market.create({
        data: {
          description: `${regionLabel}: Monthly average RRP ($/MWh). Month ending ${monthStr}. Settles to average of daily average RRPs for the month. ${AEMO_RESOLUTION} ${AEMO_DATA_SOURCE}`,
          location: region,
          eventDate: monthEnd,
          condition: 'monthly_avg_rrp',
          state: MarketState.OPEN,
          marketType: 'FUTURES',
          indexType: IndexType.DISPATCH_DAILY_RRP,
          indexId,
          minPrice: AEMO_PRICE_BOUNDS.min,
          maxPrice: AEMO_PRICE_BOUNDS.max,
          correlationGroupId: `monthly_rrp_${monthStr}`,
          contractMultiplier: AEMO_MULTIPLIER,
        },
      });
      aemoCreated++;
    }
  }

  console.log(`\nCreated ${weatherCreated} weather markets (2d + 2w + 2m × ${BOM_RAINFALL_STATIONS.length} stations × ${CLIMATE_WEEKLY_INDEX_TYPES.length} types).`);
  console.log(`Created ${aemoCreated} AEMO RRP markets (2d + 2w + 2m × ${NEM_REGIONS.length} regions).`);
  console.log(`Total: ${weatherCreated + aemoCreated} markets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
