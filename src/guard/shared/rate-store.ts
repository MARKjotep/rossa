// src/engines/framework/middlewares/shared/rate-store.ts

// Stores { count, resetTime }
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export const RateStore = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const record = RateStore.get(key);

  if (!record || record.reset < now) {
    const resetTime = now + windowMs;
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
