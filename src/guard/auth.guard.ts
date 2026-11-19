import type { ctx } from "@/http/ctx";

import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";

/**
 * Creates a guard that validates a bearer token from the `Authorization` header.
 *
 * @param validator - Checks the request context and extracted bearer token.
 * @returns A guard factory that accepts a validator and optional error configuration.
 */
export const authBearer = createGuard<
  (ctx: ctx, token?: string) => Promise<boolean> | boolean
>(
  async (ctx, next, validator, errorConfig) => {
    const token = ctx.req.headers.get("Authorization")?.trim();
    const match = token?.match(/^Bearer\s+(\S+)$/i);
    if (!match || !(await validator(ctx, match[1]!))) {
      return sendError(errorConfig);
    }

    // All validation passed for the chosen strategy! Proceed.
    return await next();
  },
  {
    id: "auth-guard",
    code: 401,
    message: "Unauthorized Access",
  },
);

/**
 * Creates a guard that validates an API key from the `x-api-key` header.
 *
 * @param validator - Checks the request context and extracted API key.
 * @returns A guard factory that accepts a validator and optional error configuration.
 */
export const apiKey = createGuard<
  (ctx: ctx, key?: string) => Promise<boolean> | boolean
>(
  async (ctx, next, validator, errorConfig) => {
    // Default to session if the developer didn't specify a strategy
    const token = ctx.req.headers.get("x-api-key");

    if (!token) {
      return sendError({
        code: 401,
        message: "Missing api key",
      });
    }

    if (!(await validator(ctx, token))) {
      return sendError({
        code: 401,
        message: "Invalid API Key.",
      });
    }

    return await next();
  },
  {
    id: "auth-guard",
    code: 401,
    message: "Unauthorized Access",
  },
);

/**
 * Creates a guard that validates one or more request headers.
 *
 * Each entry in the validator map uses a header name as its key and a callback
 * that validates that header's value.
 *
 * @param validator - Map of header names to validation callbacks.
 * @returns A guard factory that accepts validators and optional error configuration.
 */
export const auth = createGuard<
  Record<string, (ctx: ctx, keyValue?: string) => Promise<boolean> | boolean>
>(
  async (ctx, next, validator, errorConfig) => {
    // Default to session if the developer didn't specify a strategy

    for (const [headerName, validatorCallback] of Object.entries(validator)) {
      const hname = ctx.req.headers.get(headerName);

      if (!hname) {
        return sendError({
          code: 401,
          message: `Missing ${headerName} header.`,
        });
      }

      if (!(await validatorCallback(ctx, hname)))
        return sendError({
          code: 401,
          message: "Invalid.",
        });
    }

    return await next();
  },
  {
    id: "auth-guard",
    code: 401,
    message: "Unauthorized Access",
  },
);

/**
 * Checks whether the authenticated request may access a route.
 *
 * Use this after an authentication guard has established the identity in
 * `ctx`, then check roles, ownership, scopes, or other application policy in
 * the callback. A failed check returns HTTP 403 by default.
 *
 * @param canAccess - Synchronous or asynchronous authorization check.
 * @returns A guard factory that accepts the check and optional error config.
 */
export const authorize = createGuard<(ctx: ctx) => Promise<boolean> | boolean>(
  async (ctx, next, canAccess, errorConfig) => {
    if (!canAccess || !(await canAccess(ctx))) return sendError(errorConfig);
    return next();
  },
  {
    id: "authorize-guard",
    code: 403,
    message: "Forbidden",
  },
);
