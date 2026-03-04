import cron from 'node-cron';
import { runPaperTopupJob } from '../services/paperTopup';

const CRON_SCHEDULE = '0 * * * *'; // Every hour at minute 0

export function startPaperTopupCron(): void {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await runPaperTopupJob();
    } catch (err) {
      console.error('[paperTopupCron] Error:', err);
    }
  });
  console.log('[paperTopupCron] Started (hourly)');
}
