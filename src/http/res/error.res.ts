import type { ctx } from "../ctx";

export type ErrorConfig = {
  /** HTTP status code used for the response. @default 400 */
  code?: number | undefined;
  /** Message returned in the JSON `error` field; defaults to the status text. */
  message?: string | undefined;
  /** Redirect target; when set the guard answers `302` instead of an error body. */
  redirect?: string | undefined;
  /**
   * Extra response headers merged into the response. Invalid header names are
   * dropped and CR/LF/NUL/other unserializable value characters are removed
   * before the response is built. CORS headers are **not** added automatically:
   * pass `Access-Control-Allow-Origin` here (or mount `cors`) when a browser must
   * read the error response.
   */
  headers?: Record<string, string> | undefined;
  error?: (ctx: ctx) => Response;
  maxSize?: number | undefined;
};
// Map standard HTTP errors so you don't have to manually type messages every time
const STATUS_MESSAGES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/** Header name/field-value characters Bun's `Headers` accepts. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INVALID_HEADER_VALUE = /[^\t\x20-\x7e\x80-\xff]/g;

/** Copies only entries that can safely be handed to `new Response`. */
function safeHeaderSet(
  input: Record<string, string> | undefined,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    if (!HEADER_NAME_PATTERN.test(name)) continue;
    output[name] = sanitizeValue(value);
  }
  return output;
}

const sanitizeValue = (value: unknown): string =>
  String(value ?? "").replace(INVALID_HEADER_VALUE, "");

/**
 * Builds a JSON error response (`{ success: false, error, details? }`).
 *
 * Only headers supplied through `config.headers` are emitted (plus
 * `Content-Type`/`Location`); CORS headers are intentionally left to the `cors`
 * guard so a rejection cannot advertise a wildcard grant by itself. Opt in by
 * passing an explicit `Access-Control-Allow-Origin` header in the config.
 *
 * @param config - Status, message, optional headers, or redirect target.
 * @param details - Optional extra payload serialized under `details`.
 * @returns The error `Response`.
 */
export function sendError(config: ErrorConfig, details?: any): Response {
  const code = config.code ?? 400;

  // Only use explicitly provided headers; CORS is owned by the cors guard.
  const headers: Record<string, string> = safeHeaderSet(config.headers);

  if (config.redirect) {
    headers["Location"] = sanitizeValue(config.redirect);
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  headers["Content-Type"] = "application/json; charset=utf-8";

  // Fallback to the standard HTTP message if a custom one isn't provided
  const errorMessage =
    config.message ?? STATUS_MESSAGES[code] ?? "An unexpected error occurred";

  const payload = JSON.stringify({
    success: false, // Ensures consistency with your res.success() shape
    error: errorMessage,
    ...(details !== undefined && { details }),
  });

  return new Response(payload, {
    status: code,
    headers,
  });
}
