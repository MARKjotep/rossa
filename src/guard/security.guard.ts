import { createGuard } from "./@/base.guard";

export interface SecurityHeadersOptions {
  contentSecurityPolicy?: string | false;
  crossOriginEmbedderPolicy?: string | false;
  crossOriginOpenerPolicy?: string | false;
  crossOriginResourcePolicy?: string | false;
  hsts?: string | false;
  permissionsPolicy?: string | false;
  referrerPolicy?: string | false;
  xContentTypeOptions?: string | false;
  xFrameOptions?: string | false;
}

function applyHeaders(response: Response, options: SecurityHeadersOptions): Response {
  const values: Record<string, string | false | undefined> = {
    "Content-Security-Policy": options.contentSecurityPolicy,
    "Cross-Origin-Embedder-Policy": options.crossOriginEmbedderPolicy,
    "Cross-Origin-Opener-Policy": options.crossOriginOpenerPolicy,
    "Cross-Origin-Resource-Policy": options.crossOriginResourcePolicy,
    "Strict-Transport-Security": options.hsts,
    "Permissions-Policy": options.permissionsPolicy,
    "Referrer-Policy": options.referrerPolicy ?? "strict-origin-when-cross-origin",
    "X-Content-Type-Options": options.xContentTypeOptions ?? "nosniff",
    "X-Frame-Options": options.xFrameOptions ?? "DENY",
  };
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(values)) {
    if (value === false) headers.delete(name);
    else if (value) headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Adds common security headers to downstream responses. CSP and HSTS are opt-in
 * because their correct values depend on the application and deployment.
 *
 * @param options - Header values to apply or disable.
 * @returns A guard factory that applies security headers to each response.
 */
export const security = createGuard<SecurityHeadersOptions>(
  async (_ctx, next, options) => {
    const response = await next();
    return applyHeaders(response, options ?? {});
  },
  { id: "security-headers" },
);
