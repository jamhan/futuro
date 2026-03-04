/**
 * Worker process: runs cron jobs (paper top-up, auction, oracle ingestion).
 * Separate from the app server to isolate heavy work and keep the API responsive.
 * Exposes /health for liveness probes (Kubernetes/systemd).
 */

import http from 'http';
import { startPaperTopupCron } from './jobs/paperTopupCron';
import { startAuctionCron } from './jobs/auctionCron';
import { startOracleIngestionCron } from './jobs/oracleIngestionCron';
import { getMetrics, getContentType } from './services/metrics';

const WORKER_PORT = parseInt(process.env.WORKER_PORT ?? '3001', 10);

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;

  if (pathname === '/health' || pathname === '/worker/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
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
startPaperTopupCron();
startAuctionCron();
startOracleIngestionCron();

server.listen(WORKER_PORT, () => {
  console.log(`[worker] Futuro worker running on port ${WORKER_PORT}`);
  console.log(`[worker] Health: http://localhost:${WORKER_PORT}/health`);
});
