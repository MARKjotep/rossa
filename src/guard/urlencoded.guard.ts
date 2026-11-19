import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import { formDataToObject } from "./shared/form-data.util";

/**
 * Parses an URL-encoded form request and stores its fields in `ctx.form`.
 *
 * @returns A guard factory that parses URL-encoded form data before continuing.
 */
export const urlencoded = createGuard<void>(
  async (ctx, next) => {
    const contentType =
      ctx.req.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/x-www-form-urlencoded")) {
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
