import type { ctx } from "@/http/ctx";
import { sendError } from "@/http/res";
import type { CookieOptions } from "@/http/headr/headr.util";
import { setCookie } from "@/http/headr/headr.util";
import type { Req } from "@/http/req";
import { createGuard } from "./@/base.guard";

export interface CsrfOptions {
  /** Request header compared with the `csrf_token` cookie. Default: `x-csrf-token`. */
  headerName?: string;
  /**
   * Token source for unsafe requests.
   *
   * - `"header"` (default) compares the configured request header with the
   *   `csrf_token` cookie.
   * - `"double-submit"` compares a JSON or form body field with the cookie. A
   *   supplied header must still match the cookie when it is present.
   */
  mode?: "header" | "double-submit";
  /**
   * Body field read in `"double-submit"` mode. Default: `csrf_token`.
   */
  bodyField?: string;
}

/** Options accepted by {@link csrf.issue}. */
export interface CsrfIssueOptions extends CookieOptions {
  /** Cookie that stores the token. Default: `csrf_token`. */
  cookieName?: string;
  /** Explicit token value. Default: a freshly minted random UUID. */
  value?: string;
}

/** Result of {@link csrf.issue}. */
export interface CsrfIssuedToken {
  /** The minted (or explicitly supplied) token. */
  token: string;
  /** The serialized `Set-Cookie` value for the token. */
  cookie: string;
}

/** Cookie defaults for issued CSRF tokens: readable by page scripts. */
const DEFAULT_ISSUE_OPTIONS: CookieOptions = {
  path: "/",
  httpOnly: false,
  sameSite: "Lax",
};

/**
 * Extracts a token from a JSON body, URL-encoded form, or multipart form.
 *
 * Non-string field values are stringified so a numeric token still compares;
 * an unreadable or malformed body yields `undefined` instead of throwing.
 */
async function readBodyToken(req: Req, field: string): Promise<string | undefined> {
  if (req.isForm) {
    // Parse a clone so the original stream stays readable by a downstream
    // `urlencoded()`/`multipart()` guard. When the body is already consumed
    // (a parser ran first) the cached FormData is reused instead.
    let form: FormData;
    try {
      form = await req.request.clone().formData();
      req["_formData"] = form;
    } catch {
      form = await req.form();
    }

    const value = form.get(field);
    return typeof value === "string" ? value : undefined;
  }

  const body = await req.json<Record<string, unknown>>();
  const value = body?.[field];

  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : String(value);
}

/** Resolves issue options, including request-derived `secure`. */
function resolveIssueOptions(
  requestCtx: ctx,
  options: CsrfIssueOptions,
): { cookieName: string; token: string; cookieOptions: CookieOptions } {
  const { cookieName = "csrf_token", value, ...cookieOptions } = options;

  return {
    cookieName,
    token: value ?? crypto.randomUUID(),
    cookieOptions: {
      ...DEFAULT_ISSUE_OPTIONS,
      secure: requestCtx.req.url.protocol === "https:",
      ...cookieOptions,
    },
  };
}

/**
 * Mints a random CSRF token and serializes its cookie.
 *
 * When the response builder exposes {@link res.setCookie} the cookie is also
 * written through, so a handler can return its body directly:
 *
 * ```ts
 * return res.json({ csrfToken: csrf.issue(ctx).token });
 * ```
 *
 * Do not also pass the returned `cookie` to `res.header()` in that case or the
 * response will carry two `Set-Cookie` values.
 */
function issue(
  requestCtx: ctx,
  options: CsrfIssueOptions = {},
): CsrfIssuedToken {
  const { cookieName, token, cookieOptions } = resolveIssueOptions(
    requestCtx,
    options,
  );
  const cookie = setCookie(cookieName, token, cookieOptions);

  if (typeof requestCtx.res.setCookie === "function") {
    requestCtx.res.setCookie(cookieName, token, cookieOptions);
  }

  return { token, cookie };
}

const csrfGuard = createGuard<CsrfOptions>(
  async (ctx, next, options, errorConfig) => {
    // Only validate state-changing methods

    if (["POST", "PUT", "DELETE", "PATCH"].includes(ctx.req.method)) {
      const headerName = options?.headerName || "x-csrf-token";
      const expectedToken = ctx.req.cookies.get("csrf_token") || "";

      if (options?.mode === "double-submit") {
        const bodyField = options.bodyField || "csrf_token";
        const bodyToken = await readBodyToken(ctx.req, bodyField);
        const providedHeader = ctx.req.headers.get(headerName);

        if (
          !expectedToken ||
          !bodyToken ||
          bodyToken !== expectedToken ||
          (providedHeader !== null && providedHeader !== expectedToken)
        ) {
          return sendError(errorConfig);
        }
      } else {
        const providedToken = ctx.req.headers.get(headerName);

        if (!providedToken || !expectedToken || providedToken !== expectedToken) {
          return sendError(errorConfig);
        }
      }
    }
    return await next();
  },
  { id: "csrf-guard", code: 403, message: "CSRF Token Validation Failed" },
);

/**
 * Checks a CSRF token on state-changing requests (`POST`, `PUT`, `DELETE`,
 * `PATCH`).
 *
 * By default the `x-csrf-token` header is compared with the `csrf_token`
 * cookie. Pass `{ mode: "double-submit" }` to compare a JSON or form body field
 * instead:
 *
 * ```ts
 * @use(csrf({ mode: "double-submit" })) // reads the `csrf_token` body field
 * @use(csrf())                          // reads the `x-csrf-token` header
 * ```
 *
 * The guard also exposes {@link csrf.issue} (mint a token plus its cookie) and
 * {@link csrf.token} (token-only shortcut).
 *
 * @param options - Header name and token-source mode.
 * @param overrideConfig - Optional error status/message/headers.
 * @returns A guard factory that accepts CSRF options and optional error config.
 */
export const csrf = Object.assign(csrfGuard, {
  /**
   * Mints a random CSRF token, serializes its cookie, and writes the cookie
   * through when the response builder supports direct cookie writes.
   *
   * @param requestCtx - Request context used to derive cookie flags.
   * @param options - Cookie name, explicit value, and cookie flags.
   * @returns The token and its serialized `Set-Cookie` value.
   */
  issue,

  /**
   * Mints a CSRF token (see {@link csrf.issue}) and returns just its value.
   *
   * @param requestCtx - Request context used to derive cookie flags.
   * @returns The minted token.
   */
  token(requestCtx: ctx): string {
    return issue(requestCtx).token;
  },
});
