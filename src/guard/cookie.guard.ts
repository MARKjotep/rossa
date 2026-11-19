import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";

/**
 * Requires the named cookie to be present on the request.
 *
 * @param name - Cookie name to look up in the request's Cookie header.
 * @returns A guard factory that continues when the cookie exists.
 */
export const cookies = createGuard<string>(
  async (ctx, next, name, errorConfig) => {
    if (!ctx.req.cookies.has(name)) return sendError(errorConfig);
    return await next();
  },
  { id: "cookie-checker", code: 401, message: "Required cookie is missing." },
);
