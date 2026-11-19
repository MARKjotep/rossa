import type { ctx } from "@/http/ctx";
import { sendError } from "../http/res/error.res";
import { createGuard } from "./@/base.guard";

/**
 * Rule parameter: a single MIME type string, an array, or a custom validator function.
 * @example 'application/json'
 * @example ['application/json', 'multipart/form-data']
 * @example (ct, ctx) => ct?.startsWith('application/') ?? false
 */
export type ContentTypeRules =
  string | string[] | ((contentType: string | null, ctx: ctx) => boolean);

/**
 * `contentType` — validates that the request `Content-Type` matches allowed types.
 *
 * @example
 * @Use(contentType('application/json'))
 * @Post('/upload')
 * upload(ctx: RossaContext) { ... }
 */
export const contentType = createGuard<ContentTypeRules>(
  async (ctx, next, rules, errorConfig) => {
    if (!rules) return next();

    const raw = ctx.req.header("content-type") ?? null;
    const baseType = raw ? raw.split(";")[0]!.trim().toLowerCase() : null;

    let isValid = false;

    if (typeof rules === "function") {
      isValid = rules(baseType, ctx);
    } else {
      const allowed = Array.isArray(rules)
        ? rules.map(normalizeContentType)
        : [normalizeContentType(rules)];
      isValid = baseType !== null && allowed.includes(baseType);
    }

    if (!isValid) return sendError(errorConfig);
    return next();
  },
  {
    id: "content-type",
    code: 415,
    message:
      "Unsupported Media Type. The request Content-Type is invalid or missing.",
  },
);

function normalizeContentType(value: string): string {
  return value.split(";")[0]!.trim().toLowerCase();
}
