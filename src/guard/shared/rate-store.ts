// src/engines/framework/middlewares/shared/rate-store.ts

// Stores { count, resetTime }
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export const RateStore = new Map<string, { count: number; reset: number }>();

const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_ENTRIES = 100_000;

let nextSweepAt = 0;

/** Removes records whose window has already closed. */
export function sweepExpiredRateLimits(now: number = Date.now()): void {
  for (const [key, record] of RateStore) {
    if (record.reset <= now) RateStore.delete(key);
  }
  nextSweepAt = now + SWEEP_INTERVAL_MS;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Periodically drop stale keys so unique clients do not grow the map forever.
  if (now >= nextSweepAt) sweepExpiredRateLimits(now);

  const record = RateStore.get(key);

  if (!record || record.reset < now) {
    const resetTime = now + windowMs;
    if (!record && RateStore.size >= MAX_ENTRIES) {
      // Hard memory bound under extreme unique-key bursts.
      const oldestKey = RateStore.keys().next().value;
      if (oldestKey !== undefined) RateStore.delete(oldestKey);
    }
    RateStore.set(key, { count: 1, reset: resetTime });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetTime,
    };
  }

  if (record.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.reset,
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - record.count),
    resetTime: record.reset,
  };
}
