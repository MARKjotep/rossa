import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import type { AnySchema } from "@/schema";

const ALLOWED_METHODS = ["POST", "PUT", "PATCH"];

export const DEFAULT_MAX_SIZE = 1 * 1024 * 1024; // Default 1 MB limit

/**
 * Parses and validates JSON request bodies for POST, PUT, and PATCH requests.
 *
 * The validated value is stored on `ctx.body` (the same field populated by
 * `keys([...])`) and, for backwards compatibility, on the request as `_json`.
 * Handlers should read `ctx.body`; `ctx.req._json` remains supported.
 *
 * @param schema - Schema used to validate the parsed JSON object.
 * @returns A guard factory that accepts a schema and optional error config.
 */
export const json = createGuard<AnySchema>(
  async (ctx, next, schema, errorConfig) => {
    if (!ALLOWED_METHODS.includes(ctx.req.method.toUpperCase())) {
      return await next();
    }

    const contentType = ctx.req.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return sendError({
        code: 415,
        message: "Content-Type must be application/json",
      });
    }

    // 1. Check Payload Size Limit via Content-Length
    const configuredMaxSize = errorConfig.maxSize;
    const maxAllowedBytes =
      typeof configuredMaxSize === "number" && configuredMaxSize > 0
        ? configuredMaxSize
        : DEFAULT_MAX_SIZE;
    const contentLengthHeader = ctx.req.headers.get("content-length");
    if (contentLengthHeader !== null) {
      if (!/^\d+$/.test(contentLengthHeader)) {
        return sendError({
          code: 400,
          message: "Invalid Content-Length header",
        });
      }
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        return sendError({
          code: 400,
          message: "Invalid Content-Length header",
        });
      }

      if (contentLength > maxAllowedBytes) {
        return sendError({
          code: 413,
          message: `Payload exceeded maximum allowed size of ${maxAllowedBytes / 1024} KB`,
        });
      }
    }

    // 2. Read raw string to detect empty body and validate raw JSON syntax
    let rawText = "";
    try {
      rawText = await ctx.req.text();
    } catch {
      return sendError({
        code: 400,
        message: "Failed to read request stream",
      });
    }

    if (new TextEncoder().encode(rawText).byteLength > maxAllowedBytes) {
      return sendError({
        code: 413,
        message: `Payload exceeded maximum allowed size of ${maxAllowedBytes / 1024} KB`,
      });
    }

    if (!rawText || rawText.trim().length === 0) {
      return sendError({
        code: 400,
        message: "Request body cannot be empty",
      });
    }

    // 3. Parse JSON syntax (catches trailing commas, single quotes, malformed syntax)
    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch (e: any) {
      return sendError({
        code: 400,
        message: `Invalid JSON syntax: ${e.message}`,
      });
    }

    // 4. Ensure payload is a JSON object (rejects primitive values like raw numbers/strings)
    if (typeof body !== "object" || body === null) {
      return sendError({
        code: 400,
        message: "JSON payload must be a valid JSON object or array",
      });
    }

    // 5. Validate the parsed object against the supplied schema
    const result = schema.safeParse(body);

    if (!result.success) {
      return sendError({
        ...errorConfig,
        message: `Validation failed: ${result.error.issues
          .map((issue) => issue.message)
          .join(", ")}`,
      });
    }

    ctx.req["_json"] = result.data;
    ctx.body = result.data;

    return await next();
  },
  { id: "json-validator", code: 400 },
);

/*
-------------------------

-------------------------
*/
export interface RequireKeysOptions {
  keys: string[];
}

/**
 * Requires the JSON request body to contain each listed key and stores the
 * parsed body in `ctx.body`.
 *
 * @param keys - Required top-level body keys.
 * @returns A guard factory that accepts required keys and optional error config.
 */
export const keys = createGuard<string[]>(
  async (ctx, next, keys) => {
    const body = await ctx.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendError({ code: 400, message: "JSON body must be an object" });
    }
    const missingKeys = keys.filter((key) => !Object.hasOwn(body, key));

    if (missingKeys.length > 0) {
      return sendError({
        code: 400,
        message: `Missing required fields: ${missingKeys.join(", ")}`,
      });
    }

    ctx.body = body;
    return await next();
  },
  { id: "require-keys", code: 400 },
);
