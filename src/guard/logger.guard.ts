import type { ctx } from "@/http/ctx";

import { createGuard } from "./@/base.guard";

/**
 * Logs the request method, path, timestamp, and optional label before continuing.
 *
 * @param label - Optional text included in the log entry.
 * @returns A guard factory that accepts a label and optional error config.
 */
export const logger = createGuard<string | void>(
  async (ctx, next, val = "", errorConfig) => {
    const method = ctx.req.method;
    const url = new URL(ctx.req.url).pathname;

    const timestamp = new Date().toLocaleString();

    console.log(`${method} ${url} @ ${timestamp}${val ? ` | ${val}` : ""}`);

    return await next();
  },
);

type logFN = {
  ctx: ctx;
  res: Response;
  timestamp: string;
  method: string;
  url: string;
};

/**
 * Runs a formatter with request metadata and the downstream response, then logs
 * its returned value when truthy.
 *
 * @param formatter - Function that formats the request and response details.
 * @returns A guard factory that accepts a formatter and optional error config.
 */
export const loggerFN = createGuard<(ff: logFN) => any>(
  async (ctx, next, valFN, errorConfig) => {
    const method = ctx.req.method;
    const url = new URL(ctx.req.url).pathname;
    const timestamp = new Date().toLocaleTimeString();

    const res = await next();

    const ffn = valFN({ ctx, res, timestamp, method, url });

    if (ffn) console.log(ffn);

    return res;
  },
);
