import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
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
}

/** Matches a `%` that is not followed by a two-digit hex escape. */
const MALFORMED_PERCENT = /%(?![0-9A-Fa-f]{2})/;

/**
 * Parses an URL-encoded form request and stores its fields in `ctx.form`.
 *
 * By default malformed percent-encoding and NUL bytes are accepted verbatim
 * (the lenient behavior of `Request.formData()`). Pass
 * `urlencoded({ strict: true })` to reject them with the guard's error config
 * (400 by default).
 *
 * @param options - Optional `strict` parsing mode.
 * @param overrideConfig - Per-call error status/message/headers.
 * @returns A guard factory that parses URL-encoded form data before continuing.
 */
export const urlencoded = createGuard<UrlencodedOptions>(
  async (ctx, next, options, errorConfig) => {
    const contentType =
      ctx.req.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/x-www-form-urlencoded")) {
      return next();
    }

    if (options?.strict) {
      // Strict mode owns body reading so the raw payload can be inspected
      // before decoding. `ctx.req.text()` caches the text for later readers.
      const rawText = await ctx.req.text();

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
      const formData = await ctx.req.request.formData();
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
