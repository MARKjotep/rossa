import { createGuard } from "./@/base.guard";

/**
 * Serves requests for file-like paths through the configured static file server.
 * Only GET and HEAD requests are intercepted.
 *
 * @returns A guard factory that serves static assets before route handling.
 */
export const staticFiles = createGuard<void>(
  async (ctx, next) => {
    if (!ctx.req.isFile || !["GET", "HEAD"].includes(ctx.req.method)) {
      return next();
    }

    const response = await ctx.res.fileServer();
    if (ctx.req.method !== "HEAD") return response;

    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
  { id: "static-files" },
);
