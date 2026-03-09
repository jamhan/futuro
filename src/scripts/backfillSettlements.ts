import { getPrismaClient } from '../db/client';
import { SettlementService, SETTLEMENT_STATE } from '../services/settlement';
import { MarketState } from '../domain/types';

async function backfillSettlements(): Promise<void> {
  const prisma = getPrismaClient();
  const settlementService = new SettlementService();

  const markets = await prisma.market.findMany({
    where: {
      state: { in: [MarketState.LOCKED, MarketState.RESOLVED] },
      oracleResult: { isNot: null },
      OR: [
        { settlementStatus: null },
        { settlementStatus: { state: { not: SETTLEMENT_STATE.COMPLETE } } },
      ],
    },
    select: { id: true },
    orderBy: { eventDate: 'asc' },
  });

  if (markets.length === 0) {
    console.log('[backfill-settlements] No markets pending settlement');
    return;
  }

  console.log(`[backfill-settlements] Found ${markets.length} markets pending settlement`);

  let success = 0;
  const failures: { marketId: string; error: string }[] = [];

  for (const market of markets) {
    try {
      const result = await settlementService.settleMarket(market.id);
      if (result.ok) {
        success += 1;
        console.log(`[backfill-settlements] Settled ${market.id}`);
      } else {
        failures.push({ marketId: market.id, error: result.status.error ?? 'unknown error' });
        console.warn(`[backfill-settlements] ${market.id} returned status ${result.status.state}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ marketId: market.id, error: message });
      console.error(`[backfill-settlements] Failed to settle ${market.id}: ${message}`);
    }
  }

  console.log(`[backfill-settlements] Settled ${success}/${markets.length} markets`);
  if (failures.length > 0) {
    console.error('[backfill-settlements] Failures:', failures);
    process.exitCode = 1;
  }
}

backfillSettlements().catch((err) => {
  console.error('[backfill-settlements] Unhandled error', err);
  process.exit(1);
});
