import { ctx } from "@/http/ctx";

import { sendError } from "@/http/res/error.res";
import { createGuard } from "./@/base.guard";

export interface CorsOptions {
  /**
   * Allowed origin(s). Can be "*", exact origin URLs, or an array of them,
   * or a custom validator function.
   * @default "*"
   */
  origin?:
    | string
    | string[]
    | ((incomingOrigin: string | null, ctx: ctx) => string | boolean);

  /**
   * Headers allowed in requests (Access-Control-Allow-Headers).
   * @default "*"
   */
  allowHeaders?: string | string[];

  /** Methods advertised for browser preflight requests. */
  methods?: string | string[];

  /**
   * Headers exposed to the browser client (Access-Control-Expose-Headers).
   */
  exposeHeaders?: string | string[];

  /**
   * Whether to allow credentials like cookies or Authorization headers.
   * @default false
   */
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds (Access-Control-Max-Age).
   * @default 86400 (24 hours)
   */
  maxAge?: number | string;
}

function formatHeaderValue(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * Sets CORS response headers and rejects requests whose origin is not allowed.
 *
 * @param options - Allowed origins, headers, credentials, and preflight caching.
 * @returns A guard factory that accepts CORS options and optional error config.
 */
export const cors = createGuard<CorsOptions, ClassDecoratorContext>(
  async (ctx, next, options, cleanErrorConfig) => {
    const {
      origin = "*",
      allowHeaders = "*",
      methods,
      exposeHeaders,
      credentials = false,
      maxAge = 86400,
    } = options || {};

    // const method = (ctx.req.method || "").toUpperCase();

    // if (method !== "OPTIONS") return await next();

    const requestOrigin = ctx.req?.headers?.get("origin") || null;

    // 1. Resolve Access-Control-Allow-Origin
    let resolvedOrigin: string | null = null;

    if (typeof origin === "function") {
      const result = origin(requestOrigin, ctx);
      resolvedOrigin =
        typeof result === "string" ? result : result ? requestOrigin : null;
    } else if (Array.isArray(origin)) {
      if (requestOrigin && origin.some((item) => item === requestOrigin)) {
        resolvedOrigin = requestOrigin;
      }
    } else if (origin === "*") {
      resolvedOrigin = credentials
        ? requestOrigin
        : "*";
    } else {
      if (requestOrigin === origin) resolvedOrigin = requestOrigin;
    }

    // Reject invalid origin requests if an Origin header was sent
    if (requestOrigin && !resolvedOrigin) {
      return sendError(cleanErrorConfig);
    }

    // 2. Build additional CORS Headers Record
    const corsHeaders: Record<string, string> = {};

    if (resolvedOrigin) {
      corsHeaders["Access-Control-Allow-Origin"] = resolvedOrigin;
    }

    if (credentials) {
      corsHeaders["Access-Control-Allow-Credentials"] = "true";
    }

    if (exposeHeaders) {
      const formattedExpose = formatHeaderValue(exposeHeaders);
      if (formattedExpose) {
        corsHeaders["Access-Control-Expose-Headers"] = formattedExpose;
      }
    }

    if (allowHeaders) {
      const formattedAllowHeaders = formatHeaderValue(allowHeaders);
      if (formattedAllowHeaders) {
        corsHeaders["Access-Control-Allow-Headers"] = formattedAllowHeaders;
      }
    }

    if (methods) {
      const formattedMethods = formatHeaderValue(methods);
      if (formattedMethods) {
        corsHeaders["Access-Control-Allow-Methods"] = formattedMethods;
      }
    }

    if (maxAge !== undefined) {
      corsHeaders["Access-Control-Max-Age"] = maxAge.toString();
    }

    if (resolvedOrigin && resolvedOrigin !== "*") {
      corsHeaders["Vary"] = "Origin";
    }

    // 3. Set/Combine headers into existing response headers via ctx.res.header()
    ctx.res.header(corsHeaders);

    // 5. Continue pipeline for standard requests (GET, POST, etc.)
    return await next();
  },
  {
    code: 403,
    message: "CORS Origin Not Allowed",
    id: "cors-guard",
  },
);
