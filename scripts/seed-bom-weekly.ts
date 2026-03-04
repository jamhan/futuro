/**
 * Climate weekly markets only: clear all existing markets, then create
 * 8 weeks × 8 stations × 5 index types (rainfall, temp high, temp low, wind gust, solar).
 *
 * Run: npm run seed:bom-weekly
 * Optional: SEED_WEEKS=12 for 12 weeks ahead.
 */

import { PrismaClient } from '@prisma/client';
import { MarketState } from '../src/domain/types';
import {
  BOM_RAINFALL_STATIONS,
  CLIMATE_WEEKLY_INDEX_TYPES,
  getUpcomingWeekEndings,
  formatDateKey,
} from '../src/data/bomStations';

const prisma = new PrismaClient();

async function main() {
  const numWeeks = parseInt(process.env.SEED_WEEKS ?? '8', 10);

  console.log('Clearing all existing markets (orders, trades, positions, oracle results cascade)...');
  const deleted = await prisma.market.deleteMany({});
  console.log(`Deleted ${deleted.count} markets.`);

  const fromDate = new Date();
  const weekEndings = getUpcomingWeekEndings(fromDate, numWeeks);
  const total =
    BOM_RAINFALL_STATIONS.length * numWeeks * CLIMATE_WEEKLY_INDEX_TYPES.length;

  console.log(
    `Creating climate weeklies: ${BOM_RAINFALL_STATIONS.length} stations × ${numWeeks} weeks × ${CLIMATE_WEEKLY_INDEX_TYPES.length} types = ${total} markets`
  );

  for (const station of BOM_RAINFALL_STATIONS) {
    for (const weekEnd of weekEndings) {
      const weekEndStr = formatDateKey(weekEnd);
      for (const { indexType, label, unit } of CLIMATE_WEEKLY_INDEX_TYPES) {
        const indexId = `${station.id}_${indexType}_${weekEndStr}`;
        const description = `${station.name} weekly ${label} (${unit}) week ending ${weekEndStr}`;

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
          },
        });
      }
    }
  }

  console.log(`Created ${total} climate weekly markets.`);
  console.log('Types: rainfall (mm), temperature high/low (°C), max wind gust (km/h), solar exposure (MJ/m²).');
  console.log('Data source: https://www.bom.gov.au/climate/data/');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
