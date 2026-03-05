import { Counter, Gauge, Histogram, register } from 'prom-client';

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const matchingLatencyMs = new Histogram({
  name: 'matching_latency_ms',
  help: 'Time to match an order in milliseconds',
  labelNames: ['market_id'],
  buckets: [1, 2, 5, 10, 25, 50, 100, 250],
});

export const jobDurationSeconds = new Histogram({
  name: 'job_duration_seconds',
  help: 'Background job duration in seconds',
  labelNames: ['job'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const nodejsHeapUsedBytes = new Gauge({
  name: 'nodejs_heap_used_bytes',
  help: 'Node.js heap used in bytes',
});

export const nodejsHeapTotalBytes = new Gauge({
  name: 'nodejs_heap_total_bytes',
  help: 'Node.js heap total in bytes',
});

export const workerJobRunning = new Gauge({
  name: 'worker_job_running',
  help: '1 if a job is currently running, 0 otherwise (per job name)',
  labelNames: ['job'],
});

export const agentOrdersTotal = new Counter({
  name: 'agent_orders_total',
  help: 'Total orders placed by agents',
  labelNames: ['agent_id'],
});

export const agentOrderRejectionsTotal = new Counter({
  name: 'agent_order_rejections_total',
  help: 'Total order rejections for agents',
  labelNames: ['reason'],
});

export const agentRateLimitHitsTotal = new Counter({
  name: 'agent_rate_limit_hits_total',
  help: 'Total per-market rate limit rejections',
  labelNames: ['agentId', 'marketId'],
});

export const agentRateLimitTokensGauge = new Gauge({
  name: 'agent_rate_limit_tokens',
  help: 'Current tokens per (agentId, marketId) - debug only',
  labelNames: ['agentId', 'marketId'],
});


export const auctionClearingPrice = new Gauge({
  name: 'auction_clearing_price',
  help: 'Auction clearing price per market',
  labelNames: ['market_id', 'interval_id'],
});

export const auctionVolume = new Gauge({
  name: 'auction_volume',
  help: 'Auction volume per market',
  labelNames: ['market_id', 'interval_id'],
});

export const ledgerJournalsTotal = new Counter({
  name: 'ledger_journals_total',
  help: 'Total journal entries posted',
  labelNames: ['description'],
});

export const settlementJobsTotal = new Counter({
  name: 'settlement_jobs_total',
  help: 'Total settlement jobs processed',
});

export const settlementFailuresTotal = new Counter({
  name: 'settlement_failures_total',
  help: 'Total settlement job failures',
});

export async function getMetrics(): Promise<string> {
  const mem = process.memoryUsage();
  nodejsHeapUsedBytes.set(mem.heapUsed);
  nodejsHeapTotalBytes.set(mem.heapTotal);
  return register.metrics();
}

export function getContentType(): string {
  return register.contentType;
}
