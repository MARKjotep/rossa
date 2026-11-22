import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import type { AnySchema } from "@/schema";
import { formDataToObject } from "./shared/form-data.util";

/** Options accepted by {@link validateQuery}. */
export interface QueryValidationOptions {
  /** Schema used to validate and coerce query parameters. */
  schema: AnySchema;
}

/** Options accepted by {@link validateForm}. */
export interface FormValidationOptions {
  /** Schema used to validate and coerce form fields. */
  schema: AnySchema;
}

/**
 * Validates and coerces URL query parameters against a schema, then stores the
 * result in `ctx.query`.
 *
 * @param schema - Schema used to validate and coerce query values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
export const validateQuery = createGuard<AnySchema>(
  async (ctx, next, _schema, errorConfig) => {
    // 1. Normalize Options (Accepts a raw schema or options object)
    const schema = _schema;

    if (typeof schema?.safeParse !== "function") {
      return sendError({
        code: 500,
        message: "Framework Error: Missing schema in validateQuery guard.",
      });
    }

    // 2. Safe URL Normalization
    let urlObj: URL;
    try {
      urlObj =
        typeof ctx.req.url === "string"
          ? new URL(ctx.req.url, "http://localhost")
          : ctx.req.url;
    } catch {
      return sendError({
        code: errorConfig.code ?? 400,
        message: "Malformed URL structure.",
      });
    }

    // 3. Extract Raw Query Parameters
    const rawQuery: Record<string, unknown> = Object.create(null);
    urlObj.searchParams.forEach((val, key) => {
      rawQuery[key] = val;
    });

    // 4. Schema Validation & Coercion
    const result = schema.safeParse(rawQuery);

    if (!result.success) {
      return sendError({
        code: errorConfig.code ?? 400,
        message: `Query Validation Error: ${result.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      });
    }

    // 5. Attach Validated & Coerced Data to Context
    ctx.query = result.data as typeof ctx.query;

    return await next();
  },
  {
    id: "query-validator",
    code: 400,
    message: "Query validation failed",
  },
);

/**
 * Validates multipart or URL-encoded form fields against a schema and stores
 * the processed result in `ctx.form`.
 *
 * @param schema - Schema used to validate and coerce form values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
export const validateForm = createGuard<AnySchema>(
  async (ctx, next, _schema, errorConfig) => {
    // 1. Normalize Options (Accepts a raw schema or options object)
    const schema = _schema;

    if (typeof schema?.safeParse !== "function") {
      return sendError({
        code: 500,
        message: "Framework Error: Missing schema in validateForm guard.",
      });
    }

    // 2. Safely Parse Form Payload
    let rawForm: Record<string, unknown>;
    try {
      const formData = await ctx.req.form();
      rawForm = formDataToObject(formData);
    } catch {
      return sendError({
        code: errorConfig.code ?? 400,
        message: "Invalid or malformed form payload.",
      });
    }

    // 3. Schema Validation & Coercion
    const result = schema.safeParse(rawForm);

    if (!result.success) {
      return sendError({
        code: errorConfig.code ?? 400,
        message: `Form Validation Error: ${result.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      });
    }

    // 4. Attach Validated & Coerced Data to Context
    ctx.form = result.data as typeof ctx.form;

    return await next();
  },
  {
    id: "form-validator",
    code: 400,
    message: "Form validation failed",
  },
);
