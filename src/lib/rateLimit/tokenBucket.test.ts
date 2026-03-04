import {
  tryConsume,
  setNowFn,
  resetNowFn,
  clearBuckets,
} from './tokenBucket';

describe('tokenBucket', () => {
  let now = 1000;

  beforeEach(() => {
    now = 1000;
    setNowFn(() => now);
    clearBuckets();
  });

  afterEach(() => {
    resetNowFn();
  });

  it('returns ok when bucket has token', () => {
    const result = tryConsume('key1', 1, 1);
    expect(result.ok).toBe(true);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it('returns ok: false on second immediate consume', () => {
    tryConsume('key1', 1, 1);
    const result = tryConsume('key1', 1, 1);
    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBe(1000);
  });

  it('succeeds after 1 second', async () => {
    tryConsume('key1', 1, 1);
    tryConsume('key1', 1, 1);
    expect(tryConsume('key1', 1, 1).ok).toBe(false);

    now += 1100;
    const result = tryConsume('key1', 1, 1);
    expect(result.ok).toBe(true);
  });

  it('refill does not exceed capacity', () => {
    tryConsume('key1', 1, 1);
    now += 5000; // 5 seconds - would add 5 tokens but cap is 1
    const result = tryConsume('key1', 1, 1);
    expect(result.ok).toBe(true);
    // Second immediate consume should fail (only had 1 token)
    expect(tryConsume('key1', 1, 1).ok).toBe(false);
  });

  it('different keys have independent buckets', () => {
    tryConsume('keyA', 1, 1);
    tryConsume('keyB', 1, 1);

    expect(tryConsume('keyA', 1, 1).ok).toBe(false);
    expect(tryConsume('keyB', 1, 1).ok).toBe(false);

    now += 1100;
    expect(tryConsume('keyA', 1, 1).ok).toBe(true);
    expect(tryConsume('keyB', 1, 1).ok).toBe(true);
  });

  it('uses customNow when provided', () => {
    const r1 = tryConsume('k', 1, 1, 1000);
    expect(r1.ok).toBe(true);

    const r2 = tryConsume('k', 1, 1, 1000);
    expect(r2.ok).toBe(false);
    expect(r2.retryAfterMs).toBe(1000);

    const r3 = tryConsume('k', 1, 1, 2100); // 1.1 sec later
    expect(r3.ok).toBe(true);
  });
});
