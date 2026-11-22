import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import {
  checkContentLength,
  payloadTooLarge,
  readBodyWithinLimit,
  resolveMaxSize,
} from "./shared/body-cap.util";
import {
  formDataToObject,
  restoreFileTypes,
} from "./shared/form-data.util";

export interface MultipartOptions {
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

/**
 * Parses a multipart request and stores its fields and uploaded files in
 * `ctx.form`.
 *
 * Uploaded `File` objects keep the MIME type declared in their part headers,
 * including when Bun's parser reports `File.type` as empty. Field names,
 * file names, sizes, and bytes are unchanged.
 *
 * Bodies are capped at 1 MiB like `json()`; pass `multipart({ maxSize })` to
 * change the limit. Over-limit payloads answer `413` before parsing.
 *
 * @param options - Optional `maxSize` body cap.
 * @returns A guard factory that parses multipart form data before continuing.
 */
export const multipart = createGuard<MultipartOptions>(
  async (ctx, next, options) => {
    // Keep the original header value: the multipart boundary is case-sensitive.
    const contentType = ctx.req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return next();
    }

    // 1. Reject over-limit payloads from the declared size before reading.
    const maxAllowedBytes = resolveMaxSize(options?.maxSize);
    const declaredError = checkContentLength(ctx.req.headers, maxAllowedBytes);
    if (declaredError) return declaredError;

    try {
      // 2. Re-check the buffered size: Content-Length may be absent or lie.
      const body = await readBodyWithinLimit(ctx.req.request, maxAllowedBytes);
      if (body instanceof Response) return body;

      // Read the body once so the declared part types can be recovered: Bun
      // drops `File.type`, so reconstruct files from the raw part headers.
      const formData = await new Response(body, {
        headers: { "content-type": contentType },
      }).formData();
      const typedFormData = restoreFileTypes(formData, contentType, body);
      ctx.req["_formData"] = typedFormData;
      ctx.form = formDataToObject(typedFormData);
    } catch {
      return sendError({ code: 400, message: "Invalid multipart form data" });
    }

    return next();
  },
  { id: "multipart-parser", code: 400, message: "Invalid multipart form data" },
);
