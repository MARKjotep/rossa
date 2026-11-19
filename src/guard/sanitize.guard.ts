import { createGuard } from "./@/base.guard";

export interface SanitizeOptions {
  /** Custom string sanitizer. Defaults to escaping HTML-sensitive characters. */
  sanitizeString?: (value: string) => string;
  /** Whether to sanitize `ctx.query`. @default true */
  query?: boolean;
  /** Whether to sanitize `ctx.form`. @default true */
  form?: boolean;
  /** Whether to sanitize parsed JSON in `ctx.body` and `ctx.req._json`. @default true */
  body?: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#x27;";
    }
  });
}

function sanitizeValue(
  value: unknown,
  sanitizeString: (value: string) => string,
  visited = new WeakMap<object, unknown>(),
): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) {
    if (visited.has(value)) return visited.get(value);
    const result: unknown[] = [];
    visited.set(value, result);
    for (const item of value) result.push(sanitizeValue(item, sanitizeString, visited));
    return result;
  }
  if (value === null || typeof value !== "object" || value instanceof Blob) {
    return value;
  }
  if (visited.has(value)) return visited.get(value);

  const result: Record<string, unknown> = Object.create(null);
  visited.set(value, result);
  for (const [key, item] of Object.entries(value)) {
    result[key] = sanitizeValue(item, sanitizeString, visited);
  }
  return result;
}

/**
 * Escapes or custom-sanitizes string values in parsed request data before
 * handlers consume them. Continue to encode output for its final HTML context.
 *
 * @param options - Selects request data and the string sanitizer to apply.
 * @returns A guard factory that sanitizes selected context data.
 */
export const sanitize = createGuard<SanitizeOptions>(
  async (ctx, next, options) => {
    const sanitizeString = options?.sanitizeString ?? escapeHtml;

    if (options?.query !== false) {
      ctx.query = sanitizeValue(ctx.query, sanitizeString) as typeof ctx.query;
    }
    if (options?.form !== false) {
      ctx.form = sanitizeValue(ctx.form, sanitizeString) as typeof ctx.form;
    }
    if (options?.body !== false) {
      if (ctx.body !== undefined) {
        ctx.body = sanitizeValue(ctx.body, sanitizeString) as typeof ctx.body;
      }
      const parsedJson = ctx.req["_json"];
      if (parsedJson !== undefined) {
        ctx.req["_json"] = sanitizeValue(parsedJson, sanitizeString);
      }
    }

    return next();
  },
  { id: "sanitize-guard" },
);
