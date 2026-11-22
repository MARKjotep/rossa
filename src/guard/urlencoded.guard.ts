import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import {
  checkContentLength,
  payloadTooLarge,
  readBodyWithinLimit,
  resolveMaxSize,
} from "./shared/body-cap.util";
import { formDataToObject } from "./shared/form-data.util";

export interface UrlencodedOptions {
  /**
   * Reject malformed percent-encoding (`%ZZ`, a bare `%`) and NUL bytes as a
   * normal guard rejection instead of passing them through verbatim.
   *
   * The rejection uses the guard's error config, so the message and status are
   * configurable: `urlencoded({ strict: true }, { code: 422, message: "..." })`.
   *
   * @default false
   */
  strict?: boolean;
  /**
   * Maximum accepted request-body size, in bytes.
   *
   * The declared `Content-Length` is checked first, then the bytes actually
   * received, so an understated header cannot bypass the cap. Over-limit
   * payloads are rejected with `413` before the form is parsed and never reach
   * the route. The `413` status and message match `json()`'s limit response.
   *
   * @default 1048576 (1 MiB, same default as `json()`)
   */
  maxSize?: number;
}

/** Matches a `%` that is not followed by a two-digit hex escape. */
const MALFORMED_PERCENT = /%(?![0-9A-Fa-f]{2})/;

/** Media type handled by this guard. */
const URLENCODED_TYPE = "application/x-www-form-urlencoded";

/**
 * Parses an URL-encoded form request and stores its fields in `ctx.form`.
 *
 * By default malformed percent-encoding and NUL bytes are accepted verbatim
 * (the lenient behavior of `Request.formData()`). Pass
 * `urlencoded({ strict: true })` to reject them with the guard's error config
 * (400 by default).
 *
 * Bodies are capped at 1 MiB like `json()`; pass `urlencoded({ maxSize })` to
 * change the limit. Over-limit payloads answer `413` before parsing.
 *
 * @param options - Optional `strict` parsing mode and `maxSize` body cap.
 * @param overrideConfig - Per-call error status/message/headers.
 * @returns A guard factory that parses URL-encoded form data before continuing.
 */
export const urlencoded = createGuard<UrlencodedOptions>(
  async (ctx, next, options, errorConfig) => {
    const contentTypeHeader = ctx.req.headers.get("content-type") ?? "";
    if (!contentTypeHeader.toLowerCase().startsWith(URLENCODED_TYPE)) {
      return next();
    }

    // 1. Reject over-limit payloads from the declared size before reading.
    const maxAllowedBytes = resolveMaxSize(options?.maxSize);
    const declaredError = checkContentLength(ctx.req.headers, maxAllowedBytes);
    if (declaredError) return declaredError;

    if (options?.strict) {
      // Strict mode owns body reading so the raw payload can be inspected
      // before decoding. `ctx.req.text()` caches the text for later readers.
      const rawText = await ctx.req.text();

      // 2. Re-check the buffered size: Content-Length may be absent or lie.
      if (new TextEncoder().encode(rawText).byteLength > maxAllowedBytes) {
        return payloadTooLarge(maxAllowedBytes);
      }

      if (MALFORMED_PERCENT.test(rawText) || rawText.includes("\u0000")) {
        return sendError(errorConfig);
      }

      const formData = new FormData();
      for (const [key, value] of new URLSearchParams(rawText)) {
        if (key.includes("\u0000") || value.includes("\u0000")) {
          return sendError(errorConfig);
        }
        formData.append(key, value);
      }

      ctx.req["_formData"] = formData;
      ctx.form = formDataToObject(formData);
      return next();
    }

    try {
      // 2. Re-check the buffered size: Content-Length may be absent or lie.
      const body = await readBodyWithinLimit(ctx.req.request, maxAllowedBytes);
      if (body instanceof Response) return body;

      const formData = await new Response(body, {
        headers: { "content-type": contentTypeHeader },
      }).formData();
      ctx.req["_formData"] = formData;
      ctx.form = formDataToObject(formData);
    } catch {
      return sendError({ code: 400, message: "Invalid URL-encoded form data" });
    }

    return next();
  },
  {
    id: "urlencoded-parser",
    code: 400,
    message: "Invalid URL-encoded form data",
  },
);
