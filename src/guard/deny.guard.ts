import type { ctx } from "@/http/ctx";
import { type ErrorConfig, sendError } from "@/http/res";
import { createGuard } from "./@/base.guard";

export type DenyConfig = ErrorConfig & {
  /** When provided, the guard denies only requests where the predicate returns true; otherwise it continues. */
  when?: (ctx: ctx) => boolean | Promise<boolean>;
};

/**
 * Rejects requests with an HTTP error, optionally only when a predicate matches.
 *
 * Without `when` every request is denied, which is useful for maintenance
 * windows or permanently closing a route. With `when`, non-matching requests
 * continue through the remaining guards and the handler.
 *
 * ```ts
 * @use(deny())                                            // always 403
 * @use(deny({ code: 503, message: "Under maintenance" })) // custom status
 * @use(deny({ when: (ctx) => ctx.req.method === "TRACE" })) // conditional
 * ```
 *
 * @param options - Optional status, message, headers, redirect, and predicate.
 * @returns A guard factory that denies matching requests and continues otherwise.
 */
export const deny = createGuard<DenyConfig | undefined>(
  async (ctx, next, options, errorConfig) => {
    const { when, ...rest } = options ?? {};

    if (when && !(await when(ctx))) return await next();

    // Options that were explicitly left undefined fall back to the guard defaults.
    const overrides = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    ) as ErrorConfig;

    return sendError({ ...errorConfig, ...overrides });
  },
  { id: "deny", code: 403, message: "Forbidden" },
);
