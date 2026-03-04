/**
 * Token bucket rate limiter.
 * Refill: tokens = min(capacity, tokens + elapsedSec * refillPerSec)
 */

export interface TryConsumeResult {
  ok: boolean;
  retryAfterMs?: number;
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
}

const buckets = new Map<string, BucketState>();

/** Optional clock injection for tests */
let nowFn: () => number = () => Date.now();

export function setNowFn(fn: () => number): void {
  nowFn = fn;
}

export function resetNowFn(): void {
  nowFn = () => Date.now();
}

/** Clear all buckets (for tests) */
export function clearBuckets(): void {
  buckets.clear();
}

export function tryConsume(
  key: string,
  capacity: number,
  refillPerSec: number,
  customNow?: number
): TryConsumeResult {
  const now = customNow ?? nowFn();
  let state = buckets.get(key);

  if (!state) {
    state = { tokens: capacity, lastRefillAt: now };
    buckets.set(key, state);
  }

  const elapsedSec = (now - state.lastRefillAt) / 1000;
  state.tokens = Math.min(capacity, state.tokens + elapsedSec * refillPerSec);
  state.lastRefillAt = now;

  if (state.tokens >= 1) {
    state.tokens -= 1;
    return { ok: true };
  }

  const refillTimeSec = (1 - state.tokens) / refillPerSec;
  const retryAfterMs = Math.ceil(refillTimeSec * 1000);
  return { ok: false, retryAfterMs };
}
