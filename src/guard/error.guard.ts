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
 * Last-resort response used if the response builder itself cannot assemble
 * (for example because a header was poisoned through a non-public path).
 * It carries no user-controlled headers.
 */
const safeErrorResponse = (message: string): Response =>
  new Response(message, {
    status: 500,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

/**
 * Catches errors thrown by downstream guards or handlers and returns a safe
 * 500 response unless a custom handler is provided. Place it before the guards
 * and handlers whose errors it should catch.
 *
 * Header values set through `res.header()` are sanitized when written, and the
 * `res.error`/`res.json` assembler drops any remaining invalid header, so an
 * input such as `?v=a%0d%0aX-Injected:%201` produces a normal safe response
 * instead of a dropped connection. If assembly still fails, this guard answers
 * with a header-free plain-text `500`.
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
      try {
        return ctx.res.error(500, options?.message ?? "Internal Server Error");
      } catch {
        return safeErrorResponse(
          options?.message ?? "Internal Server Error",
        );
      }
    }
  },
  { id: "error-handler" },
);
