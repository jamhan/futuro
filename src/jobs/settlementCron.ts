/**
 * Settlement cron: every 1 min, scan for LOCKED markets with OracleResult
 * and enqueue settlement jobs.
 */

import { setInterval } from 'timers';
import { settlementQueue } from '../queues/settlementQueue';

const INTERVAL_MS = 60_000; // 1 minute

export function startSettlementCron(): void {
  setInterval(async () => {
    try {
      const { settlementQueue } = await import('../queues/settlementQueue');
      await settlementQueue.add('scan', { scan: true }, { jobId: `scan-${Date.now()}` });
    } catch (err) {
      console.error('[settlementCron] Failed to enqueue scan:', err);
    }
  }, INTERVAL_MS);
  console.log(`[settlementCron] Scheduled every ${INTERVAL_MS / 1000}s`);
}
