/**
 * Seed AEMO NEM daily average RRP markets.
 * Creates one market per (region, date) for the next N days.
 * Agents can bet on what the daily average RRP ($/MWh) will be.
 *
 * Run: npm run seed:aemo-daily-rrp
 * Optional: SEED_DAYS=14 for 14 days ahead.
 *
 * Does NOT clear existing markets - additive only. Use seed:bom-weekly to reset
 * (that clears all markets including these).
 */

import { PrismaClient } from '@prisma/client';
import { MarketState } from '../src/domain/types';
import { NEM_REGIONS } from '../src/config/oracle/aemoMarkets';
import { IndexType } from '../src/domain/types';

const prisma = new PrismaClient();

const PRICE_BOUNDS = { min: -500, max: 2000 }; // RRP can go negative; cap ~$15k
const CONTRACT_MULTIPLIER = 0.01; // ~$1 per 100 $/MWh

const REGION_LABELS: Record<string, string> = {
  NSW1: 'NSW',
  QLD1: 'Queensland',
  VIC1: 'Victoria',
  SA1: 'South Australia',
  TAS1: 'Tasmania',
};

function getUpcomingDates(numDays: number): Date[] {
  const results: Date[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < numDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    results.push(d);
  }
  return results;
}

function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const numDays = parseInt(process.env.SEED_DAYS ?? '7', 10);

  console.log(
    `Creating AEMO daily RRP markets: ${NEM_REGIONS.length} regions × ${numDays} days`
  );

  const dates = getUpcomingDates(numDays);
  let created = 0;
  let skipped = 0;

  for (const region of NEM_REGIONS) {
    for (const date of dates) {
      const dateStr = formatDateKey(date);
      const indexId = `${region}_daily_rrp_${dateStr}`;

      const existing = await prisma.market.findFirst({
        where: { indexId },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const regionLabel = REGION_LABELS[region] ?? region;
      const description = `${regionLabel} daily avg RRP ($/MWh) ${dateStr}`;

      await prisma.market.create({
        data: {
          description,
          location: region,
          eventDate: new Date(dateStr + 'T23:59:59Z'),
          condition: 'daily_avg_rrp',
          state: MarketState.OPEN,
          marketType: 'FUTURES',
          indexType: IndexType.DISPATCH_DAILY_RRP,
          indexId,
          minPrice: PRICE_BOUNDS.min,
          maxPrice: PRICE_BOUNDS.max,
          correlationGroupId: `daily_rrp_${dateStr}`,
          contractMultiplier: CONTRACT_MULTIPLIER,
        },
      });
      created++;
    }
  }

  console.log(`Created ${created} markets, skipped ${skipped} (already exist).`);
  console.log(
    'Agents can trade via X-Agent-Key. Oracle: run fetch:daily-rrp then POST /api/admin/oracle/import'
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
