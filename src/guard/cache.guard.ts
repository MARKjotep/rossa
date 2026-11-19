import { createGuard } from "./@/base.guard";
import type { ctx } from "@/http/ctx";

export interface CacheOptions {
  ttlMs: number;
}

type CacheEntry = {
  expires: number;
  body: Uint8Array;
  headers: Headers;
  status: number;
  statusText: string;
};

const cacheStore = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 1_000;
const BYPASS_CACHE_DIRECTIVES = new Set(["no-cache", "no-store"]);
const NO_STORE_RESPONSE_DIRECTIVES = new Set(["private", "no-store", "no-cache"]);
const ZERO_FRESHNESS_DIRECTIVES = /(?:^|,)\s*(?:max-age|s-maxage)\s*=\s*["']?0(?:\s|,|$)/i;

function hasDirective(value: string | null, directives: Set<string>): boolean {
  return (
    value
      ?.split(",")
      .some((item) => directives.has(item.trim().split("=", 1)[0]!.toLowerCase())) ??
    false
  );
}

function shouldBypass(ctx: ctx): boolean {
  const requestHeaders = ctx.req.headers;
  if (
    requestHeaders.has("authorization") ||
    requestHeaders.has("cookie") ||
    requestHeaders.has("range")
  ) {
    return true;
  }
  return (
    hasDirective(requestHeaders.get("cache-control"), BYPASS_CACHE_DIRECTIVES) ||
    requestHeaders.get("pragma")?.toLowerCase().includes("no-cache") === true
  );
}

function responseIsCacheable(response: Response): boolean {
  const cacheControl = response.headers.get("cache-control") ?? "";
  return (
    response.status === 200 &&
    !response.headers.has("set-cookie") &&
    !response.headers.has("content-range") &&
    !response.headers.has("vary") &&
    !hasDirective(cacheControl, NO_STORE_RESPONSE_DIRECTIVES) &&
    !ZERO_FRESHNESS_DIRECTIVES.test(cacheControl)
  );
}

/**
 * Caches public, successful GET responses by their full URL for the configured
 * lifetime. Requests carrying cookies or authorization headers bypass the cache.
 */
export const smartCache = createGuard<CacheOptions>(
  async (ctx, next, options) => {
    if (ctx.req.method !== "GET" || shouldBypass(ctx)) return await next();

    const ttlMs = options?.ttlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return await next();

    const now = Date.now();
    for (const [key, entry] of cacheStore) {
      if (entry.expires <= now) cacheStore.delete(key);
    }

    const cacheKey = ctx.req.url.href;
    const cached = cacheStore.get(cacheKey);
    if (cached) {
      return new Response(cached.body.slice(), {
        status: cached.status,
        statusText: cached.statusText,
        headers: new Headers(cached.headers),
      });
    }

    const response = await next();
    if (!responseIsCacheable(response)) return response;

    const clonedResponse = response.clone();
    const body = new Uint8Array(await clonedResponse.arrayBuffer());
    if (cacheStore.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cacheStore.keys().next().value;
      if (oldestKey !== undefined) cacheStore.delete(oldestKey);
    }
    cacheStore.set(cacheKey, {
      expires: now + ttlMs,
      body,
      headers: new Headers(clonedResponse.headers),
      status: clonedResponse.status,
      statusText: clonedResponse.statusText,
    });

    return response;
  },
);
