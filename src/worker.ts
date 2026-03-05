/**
 * Worker process: runs cron jobs (auction, oracle ingestion, settlement).
 * Separate from the app server to isolate heavy work and keep the API responsive.
 * Exposes /health, /healthz (liveness) and /readyz (readiness) for probes.
 */

import http from 'http';
import { startAuctionCron } from './jobs/auctionCron';
import { startOracleIngestionCron } from './jobs/oracleIngestionCron';
import { startSettlementCron } from './jobs/settlementCron';
import { createSettlementWorker } from './queues/settlementQueue';
import { getMetrics, getContentType } from './services/metrics';
import { getPrismaClient } from './db/client';

const WORKER_PORT = parseInt(process.env.WORKER_PORT ?? '3001', 10);

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;

  if (pathname === '/health' || pathname === '/healthz' || pathname === '/worker/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (pathname === '/readyz') {
    try {
      await getPrismaClient().$queryRaw`SELECT 1`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', error: 'Database unreachable' }));
    }
    return;
  }

  if (pathname === '/metrics') {
    getMetrics().then((metrics) => {
      res.writeHead(200, { 'Content-Type': getContentType() });
      res.end(metrics);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// Start cron jobs
startAuctionCron();
startOracleIngestionCron();

// Start settlement worker and cron (requires Redis - set REDIS_URL)
if (process.env.REDIS_URL) {
  try {
    createSettlementWorker();
    startSettlementCron();
    console.log('[worker] Settlement queue and cron started');
  } catch (err) {
    console.error('[worker] Settlement failed to start (Redis unreachable?):', err);
  }
} else {
  console.log('[worker] Settlement disabled: Redis not configured (set REDIS_URL)');
}

server.listen(WORKER_PORT, '0.0.0.0', () => {
  console.log(`[worker] OracleBook worker running on port ${WORKER_PORT}`);
  console.log(`[worker] Health: http://localhost:${WORKER_PORT}/health`);
});
