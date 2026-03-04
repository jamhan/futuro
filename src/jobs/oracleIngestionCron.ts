import cron from 'node-cron';
import { OracleIngestor } from '../services/oracleIngestor';
import { withJobLock } from '../lib/jobLock';

const ORACLE_CRON = process.env.ORACLE_INGESTION_CRON ?? '*/15 * * * *'; // Every 15 minutes

export function startOracleIngestionCron(): void {
  cron.schedule(ORACLE_CRON, async () => {
    try {
      const { ran } = await withJobLock('oracle_ingestion', async () => {
        const ingestor = new OracleIngestor();
        const dataDir = process.env.ORACLE_DATA_DIR;
        const result = await ingestor.ingestFromFiles(dataDir);
        console.log(
          `[oracleIngestion] filesRead=${result.filesRead} observationsCreated=${result.observationsCreated} observationsUpdated=${result.observationsUpdated} marketsResolved=${result.marketsResolved} errors=${result.errors.length}`
        );
        if (result.errors.length > 0) {
          console.warn('[oracleIngestion] Errors:', result.errors);
        }
      });
      if (!ran) {
        console.log('[oracleIngestion] Skipped (lock held by another process)');
      }
    } catch (err) {
      console.error('[oracleIngestion] Error:', err);
    }
  });
  console.log(`[oracleIngestion] Cron scheduled: ${ORACLE_CRON}`);
}
