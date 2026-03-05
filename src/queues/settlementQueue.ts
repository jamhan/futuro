/**
 * BullMQ settlement queue: scans for LOCKED markets with OracleResult,
 * enqueues settlement jobs, processes sequentially.
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getPrismaClient } from '../db/client';
import { SettlementService, SETTLEMENT_STATE } from '../services/settlement';
import { settlementJobsTotal, settlementFailuresTotal } from '../services/metrics';

const REDIS_URL = process.env.REDIS_URL;

function parseRedisUrl(
  url: string
): { host: string; port: number; password?: string } {
  try {
    const u = new URL(url);
    const opts: { host: string; port: number; password?: string } = {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
    };
    if (u.password) opts.password = u.password;
    return opts;
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

const QUEUE_NAME = 'settlement';

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    if (!REDIS_URL) throw new Error('REDIS_URL not set');
    const connectionOptions = {
      ...parseRedisUrl(REDIS_URL),
      maxRetriesPerRequest: null,
    };
    _queue = new Queue(QUEUE_NAME, {
      connection: connectionOptions,
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  }
  return _queue;
}

export const settlementQueue = {
  add: (...args: Parameters<Queue['add']>) => getQueue().add(...args),
};

const settlementService = new SettlementService();

export function createSettlementWorker(): Worker {
  if (!REDIS_URL) throw new Error('REDIS_URL not set');
  const connectionOptions = {
    ...parseRedisUrl(REDIS_URL),
    maxRetriesPerRequest: null,
  };
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ marketId: string } | { scan: true }>) => {
      const payload = job.data;

      if ('scan' in payload && payload.scan) {
        await processScanJob();
        return;
      }

      if ('marketId' in payload) {
        await processMarketJob(payload.marketId);
        return;
      }

      throw new Error('Invalid settlement job payload');
    },
    {
      connection: connectionOptions,
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    settlementFailuresTotal.inc();
    console.error(`[settlement] Job ${job?.id} failed:`, err?.message ?? err);
  });

  return worker;
}

async function processScanJob(): Promise<void> {
  const prisma = getPrismaClient();
  const markets = await prisma.market.findMany({
    where: {
      state: { in: ['LOCKED', 'RESOLVED'] },
      oracleResult: { isNot: null },
      OR: [
        { settlementStatus: null },
        { settlementStatus: { state: { not: SETTLEMENT_STATE.COMPLETE } } },
      ],
    },
    select: { id: true },
  });

  const queue = getQueue();
  for (const m of markets) {
    await queue.add('settle', { marketId: m.id }, { jobId: m.id });
  }

  if (markets.length > 0) {
    console.log(`[settlement] Enqueued ${markets.length} markets for settlement`);
  }
}

async function processMarketJob(marketId: string): Promise<void> {
  settlementJobsTotal.inc();
  const result = await settlementService.settleMarket(marketId);
  console.log(`[settlement] Market ${marketId} settled: ${result.status.state}`);
}

/**
 * Add a market to the settlement queue (for admin manual trigger)
 */
export async function enqueueSettlement(marketId: string): Promise<string> {
  const job = await getQueue().add('settle', { marketId }, { jobId: `manual-${marketId}-${Date.now()}` });
  return job.id ?? '';
}
