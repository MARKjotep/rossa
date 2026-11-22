import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";

export interface UrlValidationOptions {
  maxUrlLength?: number;
  maxQueryLength?: number;
  allowedKeys?: string[]; // Strict whitelist of allowed query parameter keys
  disallowedKeys?: string[]; // Blacklist forbidden query parameter keys
  noDuplicates?: boolean; // Reject duplicate query keys (e.g., ?id=1&id=2)
  /** Block path traversal attempts in the pathname and decoded query string (`../` or `%2e%2e`). */
  sanitizePaths?: boolean;
  patterns?: Record<string, RegExp>; // Enforce regex matching per query key
}

const DEFAULT_MAX_URL = 2048; // 2 KB
const DEFAULT_MAX_QUERY = 1024; // 1 KB

/** Decodes repeatedly so double-encoded traversal (`%252e`) is still visible. */
function decodeFully(value: string): string {
  let decoded = value;
  let previous = "";
  while (decoded !== previous && decoded.includes("%")) {
    previous = decoded;
    decoded = decodeURIComponent(decoded);
  }
  return decoded;
}

/** Detects the traversal markers used for both pathnames and query strings. */
function hasTraversalMarker(value: string): boolean {
  return (
    value.includes("../") || value.includes("..\\") || value.includes("/..")
  );
}

/**
 * Validates URL and query limits, query keys, duplicate keys, and path safety.
 *
 * Traversal markers are rejected in both the decoded pathname and the decoded
 * query string unless `sanitizePaths` is `false`, so `/search?x=../etc`
 * answers 400 under the default configuration.
 *
 * @param options - URL size, query, and path validation rules.
 * @returns A guard factory that accepts validation rules and optional error config.
 */
export const validateUrl = createGuard<
  UrlValidationOptions | number | void
>(
  async (ctx, next, options, errorConfig) => {
    // 1. Normalize Options
    const opts: UrlValidationOptions =
      typeof options === "number" ? { maxUrlLength: options } : options || {};

    const maxUrl = opts.maxUrlLength ?? DEFAULT_MAX_URL;
    const maxQuery = opts.maxQueryLength ?? DEFAULT_MAX_QUERY;

    // 2. Parse URL safely (Handles string or native URL object)
    let urlObj: URL;
    try {
      urlObj =
        typeof ctx.req.url === "string"
          ? new URL(ctx.req.url, "http://localhost")
          : ctx.req.url;
    } catch {
      return sendError({
        code: 400,
        message: "Malformed URL structure.",
      });
    }

    const fullUrl = urlObj.href;

    // 3. Full URL Length Guard
    if (fullUrl.length > maxUrl) {
      return sendError({
        code: 414,
        message: `URI Too Long. Exceeds limit of ${maxUrl} characters.`,
      });
    }

    // 4. Query String Extraction & Length Guard
    const queryString = urlObj.search.startsWith("?")
      ? urlObj.search.slice(1)
      : urlObj.search;

    if (queryString.length > maxQuery) {
      return sendError({
        code: 414,
        message: `Query string too long. Exceeds limit of ${maxQuery} characters.`,
      });
    }

    // 5. Path Traversal & Injection Guard
    if (opts.sanitizePaths !== false) {
      let decodedPath: string;
      let decodedSearch: string;
      try {
        // Multi-pass decoding catches double-encoded traversal attempts (%252e -> %2e -> .)
        decodedPath = decodeFully(urlObj.pathname);
        decodedSearch = decodeFully(urlObj.search);
      } catch {
        return sendError({
          code: 400,
          message: "Malformed percent-encoding in URL.",
        });
      }

      // Detect null byte injection
      if (decodedPath.includes("\0") || decodedSearch.includes("\0")) {
        return sendError({
          code: 400,
          message: "Null byte injection detected in URL.",
        });
      }

      // Detect directory traversal sequences in the pathname and in decoded
      // query values: query data can reach filesystem or template sinks too,
      // so the same markers are rejected in both places.
      if (
        hasTraversalMarker(decodedPath) ||
        hasTraversalMarker(decodedSearch)
      ) {
        return sendError({
          code: 400,
          message: "Path traversal attempt detected in URL.",
        });
      }
    }

    // 6. Query Parameter Inspection
    const searchParams = urlObj.searchParams;
    const keysPresent = Array.from(searchParams.keys());

    if (keysPresent.length > 0) {
      // A. Check for Duplicate Parameters
      if (opts.noDuplicates) {
        const uniqueKeys = new Set(keysPresent);
        if (uniqueKeys.size !== keysPresent.length) {
          return sendError({
            code: errorConfig.code ?? 400,
            message: "Duplicate query parameters are not allowed.",
          });
        }
      }

      // B. Key Whitelisting
      if (opts.allowedKeys) {
        const allowedSet = new Set(opts.allowedKeys);
        for (const key of keysPresent) {
          if (!allowedSet.has(key)) {
            return sendError({
              code: errorConfig.code ?? 400,
              message: `Unauthorized query parameter: '${key}'`,
            });
          }
        }
      }

      // C. Key Blacklisting
      if (opts.disallowedKeys) {
        const forbiddenSet = new Set(opts.disallowedKeys);
        for (const key of keysPresent) {
          if (forbiddenSet.has(key)) {
            return sendError({
              code: errorConfig.code ?? 400,
              message: `Forbidden query parameter: '${key}'`,
            });
          }
        }
      }

      // D. Regex Pattern Validation per Query Parameter (Validates all array values)
      if (opts.patterns) {
        for (const [key, pattern] of Object.entries(opts.patterns)) {
          const values = searchParams.getAll(key);
          for (const val of values) {
            pattern.lastIndex = 0;
            const matches = pattern.test(val);
            pattern.lastIndex = 0;
            if (!matches) {
              return sendError({
                code: errorConfig.code ?? 400,
                message: `Invalid format for query parameter '${key}'.`,
              });
            }
          }
        }
      }
    }

    return await next();
  },
  {
    id: "url-validator",
    code: 400,
    message: "URL validation failed",
  },
);
