import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import { coerceRawObject, type SchemaBuilder } from "./json/schema.json";
import { formDataToObject } from "./shared/form-data.util";

export interface QueryValidationOptions<T extends Record<string, any>> {
  schema: SchemaBuilder<T>;
}

export interface FormValidationOptions<T extends Record<string, any>> {
  schema: SchemaBuilder<T>;
}

/**
 * Validates and coerces URL query parameters against a schema, then stores the
 * result in `ctx.query`.
 *
 * @param schema - Schema used to validate and coerce query values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
export const validateQuery = createGuard<SchemaBuilder<{}>>(
  async (ctx, next, _schema, errorConfig) => {
    // 1. Normalize Options (Accepts raw SchemaBuilder or options object)
    const schema = _schema;

    if (!schema || typeof schema.validate !== "function") {
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
    const rawQuery: Record<string, any> = Object.create(null);
    urlObj.searchParams.forEach((val, key) => {
      rawQuery[key] = val;
    });

    // 4. Type Coercion & Schema Validation
    const coercedData = coerceRawObject(rawQuery, schema);
    const { errors, processedData } = schema.validate(coercedData);

    if (errors.length > 0) {
      return sendError({
        code: errorConfig.code ?? 400,
        message: `Query Validation Error: ${errors.join("; ")}`,
      });
    }

    // 5. Attach Validated & Coerced Data to Context
    ctx.query = processedData;

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
export const validateForm = createGuard<SchemaBuilder<{}>>(
  async (ctx, next, _schema, errorConfig) => {
    // 1. Normalize Options (Accepts raw SchemaBuilder or options object)
    const schema = _schema;

    if (!schema || typeof schema.validate !== "function") {
      return sendError({
        code: 500,
        message: "Framework Error: Missing schema in validateForm guard.",
      });
    }

    // 2. Safely Parse Form Payload
    let rawForm: Record<string, any>;
    try {
      const formData = await ctx.req.form();
      rawForm = formDataToObject(formData);
    } catch {
      return sendError({
        code: errorConfig.code ?? 400,
        message: "Invalid or malformed form payload.",
      });
    }

    // 3. Type Coercion & Schema Validation
    const coercedData = coerceRawObject(rawForm, schema);
    const { errors, processedData } = schema.validate(coercedData);

    if (errors.length > 0) {
      return sendError({
        code: errorConfig.code ?? 400,
        message: `Form Validation Error: ${errors.join("; ")}`,
      });
    }

    // 4. Attach Validated & Coerced Data to Context
    ctx.form = processedData;

    return await next();
  },
  {
    id: "form-validator",
    code: 400,
    message: "Form validation failed",
  },
);
