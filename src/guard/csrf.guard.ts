import { sendError } from "@/http/res";
import { createGuard } from "./@/base.guard";

export interface CsrfOptions {
  headerName?: string; // Default: 'x-csrf-token'
}

/**
 * Checks a CSRF header against the `csrf_token` cookie on state-changing requests.
 *
 * @param options - Optional name of the request header containing the token.
 * @returns A guard factory that accepts CSRF options and optional error config.
 */
export const csrf = createGuard<CsrfOptions>(
  async (ctx, next, options, errorConfig) => {
    // Only validate state-changing methods

    if (["POST", "PUT", "DELETE", "PATCH"].includes(ctx.req.method)) {
      const headerName = options?.headerName || "x-csrf-token";
      const providedToken = ctx.req.headers.get(headerName);

      const expectedToken = ctx.req.cookies.get("csrf_token") || "";

      if (!providedToken || !expectedToken || providedToken !== expectedToken) {
        return sendError(errorConfig);
      }
    }
    return await next();
  },
  { id: "csrf-guard", code: 403, message: "CSRF Token Validation Failed" },
);
