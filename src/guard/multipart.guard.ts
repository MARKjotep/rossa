import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import { formDataToObject } from "./shared/form-data.util";

/**
 * Parses a multipart request and stores its fields and uploaded files in
 * `ctx.form`.
 *
 * @returns A guard factory that parses multipart form data before continuing.
 */
export const multipart = createGuard<void>(
  async (ctx, next) => {
    const contentType =
      ctx.req.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("multipart/form-data")) return next();

    try {
      const formData = await ctx.req.request.formData();
      ctx.req["_formData"] = formData;
      ctx.form = formDataToObject(formData);
    } catch {
      return sendError({ code: 400, message: "Invalid multipart form data" });
    }

    return next();
  },
  { id: "multipart-parser", code: 400, message: "Invalid multipart form data" },
);
