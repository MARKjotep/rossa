import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import {
  formDataToObject,
  restoreFileTypes,
} from "./shared/form-data.util";

/**
 * Parses a multipart request and stores its fields and uploaded files in
 * `ctx.form`.
 *
 * Uploaded `File` objects keep the MIME type declared in their part headers,
 * including when Bun's parser reports `File.type` as empty. Field names,
 * file names, sizes, and bytes are unchanged.
 *
 * @returns A guard factory that parses multipart form data before continuing.
 */
export const multipart = createGuard<void>(
  async (ctx, next) => {
    // Keep the original header value: the multipart boundary is case-sensitive.
    const contentType = ctx.req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return next();
    }

    try {
      // Read the body once so the declared part types can be recovered: Bun
      // drops `File.type`, so reconstruct files from the raw part headers.
      const body = new Uint8Array(await ctx.req.request.arrayBuffer());
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
