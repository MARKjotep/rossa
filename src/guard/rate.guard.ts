import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import { getIP } from "./shared/get-ip";
import { checkRateLimit } from "./shared/rate-store";

export interface RateLimitOptions {
  /** Maximum number of connections/requests allowed within the window. @default 100 */
  max?: number;
  /** Window duration in milliseconds. @default 60000 (1 minute) */
  windowMs?: number;
  /** Whether to attach X-RateLimit-* headers to responses. @default true */
  expose?: boolean;
}

/**
 * Limits requests by client IP, HTTP method, and URL path.
 *
 * @param options - Request limit, time window, and response-header settings.
 * @returns A guard factory that accepts rate-limit settings and optional error config.
 */
export const rateLimit = createGuard<RateLimitOptions>(
  async (ctx, next, options, errorConfig) => {
    const {
      max = 100,
      windowMs = 60 * 1000, // 1 minute window
      expose = true,
    } = options || {};

    const ip = getIP(ctx);
    const method = ctx.req.method;
    const routeKey = `rate_${ip}_${method}_${new URL(ctx.req.url).pathname}`;

    const { allowed, remaining, resetTime } = checkRateLimit(
      routeKey,
      max,
      windowMs,
    );

    const headers: Record<string, string> = {};

    if (expose) {
      headers["X-RateLimit-Limit"] = max.toString();
      headers["X-RateLimit-Remaining"] = remaining.toString();
      headers["X-RateLimit-Reset"] = Math.ceil(resetTime / 1000).toString();
    }

    if (!allowed) {
      if (expose) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((resetTime - Date.now()) / 1000),
        );
        headers["Retry-After"] = retryAfterSeconds.toString();
      }

      return sendError({
        ...errorConfig,
        headers,
      });
    }

    const response = await next();

    if (expose) {
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    }

    return response;
  },
  { id: "rate-limiter", code: 429, message: "Too Many Requests" },
);
