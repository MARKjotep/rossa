import type { ctx } from "../ctx";

export type ErrorConfig = {
  code?: number | undefined;
  message?: string | undefined;
  redirect?: string | undefined;
  // maxSize?: number | undefined;
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

export function sendError(config: ErrorConfig, details?: any): Response {
  const code = config.code ?? 400;

  // Use provided headers, falling back to a wildcard CORS if not specified
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    ...(config.headers || {}),
  };

  if (config.redirect) {
    headers["Location"] = config.redirect;
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
