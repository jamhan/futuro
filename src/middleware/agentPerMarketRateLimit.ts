import { Request, Response, NextFunction } from 'express';
import { tryConsume } from '../lib/rateLimit/tokenBucket';
import { agentRateLimitHitsTotal } from '../services/metrics';

const TRUSTED_IDS = (process.env.AGENT_RATE_LIMIT_TRUSTED_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const HIT_WARN_THRESHOLD = 10;
const HIT_WINDOW_MS = 60_000;

const hitTimestampsByAgent = new Map<string, number[]>();

function recordHitAndMaybeWarn(agentId: string): void {
  const now = Date.now();
  let timestamps = hitTimestampsByAgent.get(agentId);
  if (!timestamps) {
    timestamps = [];
    hitTimestampsByAgent.set(agentId, timestamps);
  }
  timestamps.push(now);
  // Prune older than 60s
  const cutoff = now - HIT_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length > HIT_WARN_THRESHOLD) {
    console.warn(
      `[rate-limit] Agent ${agentId} exceeded per-market rate limit ${timestamps.length} times in the last minute`
    );
  }
}

/** Unverified agents: 1 order per 5 min per market. Configurable via AGENT_UNVERIFIED_ORDER_INTERVAL_SEC. */
const UNVERIFIED_ORDER_INTERVAL_SEC = parseInt(
  process.env.AGENT_UNVERIFIED_ORDER_INTERVAL_SEC ?? '300',
  10
);

/**
 * Per-agent, per-market rate limit.
 * - VERIFIED/TRUSTED: max 1 order/sec per (agent, market).
 * - UNVERIFIED: 1 order per 5 min (AGENT_UNVERIFIED_ORDER_INTERVAL_SEC) per market.
 * Skips when req.agent is not set or marketId is missing (handler will validate).
 * Trusted agents (AGENT_RATE_LIMIT_TRUSTED_IDS) bypass this limit.
 */
export function agentPerMarketRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.agent) return next();

  const marketId = req.body?.marketId;
  if (typeof marketId !== 'string' || !marketId.trim()) {
    return next();
  }

  const agentId = req.agent.id;
  if (TRUSTED_IDS.includes(agentId)) {
    return next();
  }

  const key = `${agentId}:${marketId}`;
  const isUnverified = (req.agent.trustTier ?? 'VERIFIED') === 'UNVERIFIED';
  const capacity = 1;
  const refillPerSec = isUnverified ? 1 / UNVERIFIED_ORDER_INTERVAL_SEC : 1;
  const result = tryConsume(key, capacity, refillPerSec);

  if (!result.ok) {
    agentRateLimitHitsTotal.inc({ agentId, marketId });
    recordHitAndMaybeWarn(agentId);

    const retryAfterMs = result.retryAfterMs ?? 1000;
    const limitDesc = isUnverified
      ? `1 order per ${UNVERIFIED_ORDER_INTERVAL_SEC}s (unverified agent)`
      : '1 order/sec';
    res.set('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
    res.status(429).json({
      error: {
        code: 'ERR_RATE_LIMIT_PER_MARKET',
        message: `Rate limit exceeded: max ${limitDesc} on market ${marketId}.`,
        retry_after_ms: retryAfterMs,
      },
    });
    return;
  }

  next();
}
