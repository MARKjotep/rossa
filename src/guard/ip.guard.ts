import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import { getIP } from "./shared/get-ip";
import { IpMatcher, type IpOptions } from "./shared/ip-matcher";

/**
 * Allows or blocks requests based on configured client IP allow and deny lists.
 *
 * @param options - IP allowlist and blocklist rules.
 * @returns A guard factory that accepts IP rules and optional error config.
 */
export const ipFilter = createGuard<IpOptions>(
  async (ctx, next, options, errorConfig) => {
    const clientIP = getIP(ctx);
    const { blacklist = [], whitelist = [] } = options ?? {};

    // Deny rules always take precedence over allow rules.
    if (blacklist.length) {
      if (new IpMatcher(blacklist).test(clientIP)) return sendError(errorConfig);
    }

    if (whitelist.length) {
      if (!new IpMatcher(whitelist).test(clientIP)) return sendError(errorConfig);
    }

    return await next();
  },
  { id: "ip-filter", code: 403, message: "Forbidden" },
);
