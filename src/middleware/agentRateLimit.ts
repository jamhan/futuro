import { Request, Response, NextFunction } from 'express';
import { agentOrderRejectionsTotal } from '../services/metrics';

const ORDERS_PER_MIN = parseInt(process.env.AGENT_RATE_LIMIT_ORDERS_PER_MIN ?? '60', 10);
const MIN_SPACING_MS = parseInt(process.env.AGENT_RATE_LIMIT_MIN_SPACING_MS ?? '1000', 10);
const REFILL_MS = 60_000;

function isGlobalEnabled(): boolean {
  return (process.env.AGENT_RATE_LIMIT_GLOBAL_ENABLED ?? 'true').toLowerCase() !== 'false';
}

interface AgentBucket {
  tokens: number;
  lastRefillAt: number;
  lastOrderAt: number;
}

const buckets = new Map<string, AgentBucket>();

function getOrCreateBucket(agentId: string): AgentBucket {
  let b = buckets.get(agentId);
  const now = Date.now();
  if (!b) {
    b = { tokens: ORDERS_PER_MIN, lastRefillAt: now, lastOrderAt: 0 };
    buckets.set(agentId, b);
    return b;
  }
  const elapsed = now - b.lastRefillAt;
  if (elapsed >= REFILL_MS) {
    b.tokens = ORDERS_PER_MIN;
    b.lastRefillAt = now;
  }
  return b;
}

function tryConsume(agentId: string): { ok: boolean; retryAfterMs?: number } {
  const b = getOrCreateBucket(agentId);
  const now = Date.now();

  if (now - b.lastOrderAt < MIN_SPACING_MS) {
    return { ok: false, retryAfterMs: MIN_SPACING_MS - (now - b.lastOrderAt) };
  }
  if (b.tokens <= 0) {
    return { ok: false, retryAfterMs: REFILL_MS - (now - b.lastRefillAt) };
  }

  b.tokens -= 1;
  b.lastOrderAt = now;
  return { ok: true };
}

/**
 * Rate limit for agent order placement. Only applies when req.agent is set.
 * Token bucket: ORDERS_PER_MIN per minute, min MIN_SPACING_MS between orders.
 * Set AGENT_RATE_LIMIT_GLOBAL_ENABLED=false to disable (per-market limit only).
 */
export function agentRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.agent) return next();
  if (!isGlobalEnabled()) return next();

  const result = tryConsume(req.agent.id);
  if (!result.ok) {
    agentOrderRejectionsTotal.inc({ reason: 'rate_limit' });
    res.set('Retry-After', Math.ceil((result.retryAfterMs ?? 60) / 1000).toString());
    res.status(429).json({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterMs: result.retryAfterMs,
    });
    return;
  }
  next();
}
