import type { ctx } from "@/http/ctx";
import { createGuard } from "./@/base.guard";

export interface ErrorGuardOptions {
  /** Log caught errors. Defaults to false. */
  logErrors?: boolean;
  /** Safe message returned for unexpected errors. */
  message?: string;
  /** Custom response handler. */
  onError?: (error: unknown, ctx: ctx) => Response | Promise<Response>;
}

/**
 * Catches errors thrown by downstream guards or handlers and returns a safe
 * 500 response unless a custom handler is provided. Place it before the guards
 * and handlers whose errors it should catch.
 *
 * @param options - Logging, public message, and custom error response behavior.
 * @returns A guard factory that wraps downstream execution with error handling.
 */
export const errorHandler = createGuard<ErrorGuardOptions>(
  async (ctx, next, options) => {
    try {
      return await next();
    } catch (error) {
      if (options?.logErrors) console.error(error);
      if (options?.onError) return await options.onError(error, ctx);
      return ctx.res.error(500, options?.message ?? "Internal Server Error");
    }
  },
  { id: "error-handler" },
);
