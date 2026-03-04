import cron from 'node-cron';
import { runPaperTopupJob } from '../services/paperTopup';
import { withJobLock } from '../lib/jobLock';
import { jobDurationSeconds, workerJobRunning } from '../services/metrics';

const CRON_SCHEDULE = process.env.PAPER_TOPUP_CRON ?? '0 * * * *'; // Every hour at minute 0

export function startPaperTopupCron(): void {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      const { ran } = await withJobLock('paper_topup', async () => {
        await runPaperTopupJob();
      });
      if (!ran) {
        console.log('[paperTopupCron] Skipped (lock held by another process)');
      }
    } catch (err) {
      console.error('[paperTopupCron] Error:', err);
    }
  });
  console.log(`[paperTopupCron] Started: ${CRON_SCHEDULE}`);
}
