import cron from 'node-cron';
import { AuctionService } from '../services/auctionService';
import { broadcast } from '../services/wsBroadcast';
import { auctionClearingPrice, auctionVolume } from '../services/metrics';
import { withJobLock } from '../lib/jobLock';

const auctionService = new AuctionService();

/**
 * Run auction for the previous hour's interval.
 * Cron: at :00 every hour (e.g. 14:00 runs auction for 13:00 interval).
 */
async function runAuctionJob(): Promise<void> {
  const { ran } = await withJobLock('auction', async () => {
    const now = new Date();
    now.setHours(now.getHours() - 1);
    const intervalId = AuctionService.getIntervalId(now);
    console.log(`[auction] Running auction for interval ${intervalId}`);
    const results = await auctionService.runAndPersist(intervalId);
    console.log(`[auction] Completed for ${intervalId}`);
    for (const r of results) {
      const cp = Number(r.clearingPrice.toString());
      const vol = Number(r.volume.toString());
      auctionClearingPrice.set({ market_id: r.marketId, interval_id: intervalId }, cp);
      auctionVolume.set({ market_id: r.marketId, interval_id: intervalId }, vol);
      broadcast({
        type: 'auction_outcome',
        payload: {
          intervalId,
          marketId: r.marketId,
          clearingPrice: cp,
          volume: vol,
        },
      });
    }
  });
  if (!ran) {
    console.log('[auction] Skipped (lock held by another process)');
  }
}

const AUCTION_CRON = process.env.AUCTION_CRON ?? '0 * * * *';

export function startAuctionCron(): void {
  cron.schedule(AUCTION_CRON, () => {
    runAuctionJob().catch((err) => console.error('[auction] Error:', err));
  });
  console.log(`[auction] Cron scheduled: ${AUCTION_CRON}`);
}
