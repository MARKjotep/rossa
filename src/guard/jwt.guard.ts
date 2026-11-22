import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import type { ErrorConfig } from "@/http/res";
import type {
  JWTAuthService,
  RefreshConsumeResult,
  RefreshRejectionReason,
} from "@/auth/jwt/jwt-service";
import type { JwtPayload } from "@/auth/jwt/jwt-engine";

export type {
  RefreshConsumeResult,
  RefreshRejectionReason,
} from "@/auth/jwt/jwt-service";

/** Adds the RFC 9110 Bearer challenge to a set of error headers. */
function challengeHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  return { ...(headers ?? {}), "WWW-Authenticate": "Bearer" };
}

/** Extracts the credential from a `Bearer` Authorization header. */
function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.trim().match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/** 401 for a missing or invalid access token. */
function denyAccess(headers?: Record<string, string>): Response {
  return sendError({
    code: 401,
    message: "Unauthorized Access",
    headers: challengeHeaders(headers),
  });
}

/**
 * 401 for a refresh failure. Keeps the guard's status/message defaults and
 * adds a machine-readable `error_code` (`invalid` | `expired` | `reused`).
 */
async function refreshError(
  errorConfig: ErrorConfig & Record<string, any>,
  reason: RefreshRejectionReason,
): Promise<Response> {
  const base = sendError({
    ...errorConfig,
    headers: challengeHeaders(errorConfig.headers),
  });

  if (base.status === 302) return base;

  const headers = new Headers(base.headers);
  let payload: Record<string, any>;

  try {
    payload = (await base.json()) as Record<string, any>;
  } catch {
    payload = {
      success: false,
      error: errorConfig.message ?? "Refresh Token Failed",
    };
  }

  payload.error_code = reason;

  return new Response(JSON.stringify(payload), {
    status: base.status,
    headers,
  });
}

/**
 * Consumes a refresh token, falling back to the boolean-compatible
 * `consume()` for custom services that do not expose a reason.
 */
async function consumeRefresh(
  service: JWTAuthService<any>,
  token: string,
): Promise<RefreshConsumeResult<any>> {
  const detailed = service as JWTAuthService<any> & {
    consumeWithReason?: (value: string) => Promise<RefreshConsumeResult<any>>;
  };

  if (typeof detailed.consumeWithReason === "function") {
    return detailed.consumeWithReason(token);
  }

  const claims = await service.consume(token);
  return claims
    ? { ok: true, claims }
    : { ok: false, reason: "invalid" };
}

/**
 * Verifies a Bearer access token and stores its decoded claims in
 * `ctx.jwtData`.
 *
 * Every rejection carries `WWW-Authenticate: Bearer` and the guard's 401
 * body. When composing with {@link jwtRefresh}, mount this guard first so the
 * refresh guard runs with an already-validated access token:
 *
 * ```ts
 * @use(jwtAuth(service), jwtRefresh(service))
 * ```
 *
 * @param service - JWT service used to verify the access token.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
export const jwtAuth = createGuard<JWTAuthService<any>>(
  async (ctx, next, service, errorConfig) => {
    if (!service) {
      throw new Error("jwtAuth requires a JWTAuthService instance.");
    }

    const authHeader = ctx.req.headers.get("Authorization");
    const token = parseBearer(authHeader);
    if (!token) {
      return sendError({
        ...errorConfig,
        headers: challengeHeaders(errorConfig.headers),
      });
    }

    const decodedPayload = service.verify(token);

    if (!decodedPayload) {
      return sendError({
        ...errorConfig,
        headers: challengeHeaders(errorConfig.headers),
      });
    }

    ctx.jwtData = decodedPayload;

    return await next();
  },
  {
    id: "jwt-auth-guard",
    code: 401,
    message: "Unauthorized Access",
  },
);

/**
 * Consumes an `x-refresh-token`, issues a replacement token pair, and stores
 * the refresh claims in `ctx.data.jwtRefreshData` and the new tokens in
 * `ctx.data.jwtTokens`.
 *
 * `ctx.jwtData` is only populated with the refresh claims when the access
 * guard has not already set it; access claims therefore win on combined
 * routes. When an `Authorization` header is present, the access token is
 * verified before the refresh token is consumed, so a refresh-first route
 * does not burn the token when authentication ultimately fails.
 *
 * Compose after {@link jwtAuth} where possible, or use {@link jwtRotate} for
 * a single rotation endpoint:
 *
 * ```ts
 * @use(jwtAuth(service), jwtRefresh(service))
 * ```
 *
 * @param service - JWT service used to consume and issue tokens.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
export const jwtRefresh = createGuard<JWTAuthService<any>>(
  async (ctx, next, service, errorConfig) => {
    if (!service) {
      throw new Error("jwtRefresh requires a JWTAuthService instance.");
    }

    // Refresh-first safety: if the route also carries an access token, prove
    // it is valid before claiming the refresh token. A failing access token
    // must not consume the refresh token the client still needs.
    const authHeader = ctx.req.headers.get("Authorization");
    if (authHeader !== null) {
      const accessToken = parseBearer(authHeader);
      if (!accessToken || !service.verify(accessToken)) {
        return denyAccess(errorConfig.headers);
      }
    }

    const refreshToken = ctx.req.headers.get("x-refresh-token")?.trim();
    if (!refreshToken || /\s/.test(refreshToken)) {
      return await refreshError(errorConfig, "invalid");
    }

    // The service validates the signature and atomically claims the stored token.
    const result = await consumeRefresh(service, refreshToken);

    if (!result.ok) return await refreshError(errorConfig, result.reason);

    const claims = result.claims;

    ctx.data.jwtRefreshData = claims;
    if (Object.keys(ctx.jwtData).length === 0) {
      ctx.jwtData = claims;
    }
    ctx.data.jwtTokens = await service.issue(claims);

    return await next();
  },
  {
    id: "jwt-refresh-guard",
    code: 401,
    message: "Refresh Token Failed",
  },
);

/**
 * Rotates a session in one guard: verifies the access token when present and
 * then consumes the refresh token.
 *
 * - Access token present and invalid → 401 without consuming the refresh
 *   token, so a failed authentication never burns it.
 * - Access token present and valid → its claims stay in `ctx.jwtData`.
 * - Access token absent → refresh claims become `ctx.jwtData` (refresh-only
 *   rotation).
 *
 * The refresh claims are always also exposed as `ctx.data.jwtRefreshData` and
 * the replacement pair as `ctx.data.jwtTokens`. Every 401 carries
 * `WWW-Authenticate: Bearer`; refresh failures include `error_code`.
 *
 * ```ts
 * @use(jwtRotate(service))
 * ```
 *
 * @param service - JWT service used to verify, consume, and issue tokens.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
export const jwtRotate = createGuard<JWTAuthService<any>>(
  async (ctx, next, service, errorConfig) => {
    if (!service) {
      throw new Error("jwtRotate requires a JWTAuthService instance.");
    }

    const authHeader = ctx.req.headers.get("Authorization");
    let accessClaims: JwtPayload<any> | null = null;

    if (authHeader !== null) {
      const accessToken = parseBearer(authHeader);
      accessClaims = accessToken ? service.verify(accessToken) : null;

      if (!accessClaims) return denyAccess(errorConfig.headers);
    }

    const refreshToken = ctx.req.headers.get("x-refresh-token")?.trim();
    if (!refreshToken || /\s/.test(refreshToken)) {
      return await refreshError(errorConfig, "invalid");
    }

    const result = await consumeRefresh(service, refreshToken);
    if (!result.ok) return await refreshError(errorConfig, result.reason);

    const claims = result.claims;
    ctx.data.jwtRefreshData = claims;

    if (accessClaims) {
      ctx.jwtData = accessClaims;
    } else if (Object.keys(ctx.jwtData).length === 0) {
      ctx.jwtData = claims;
    }

    ctx.data.jwtTokens = await service.issue(claims);

    return await next();
  },
  {
    id: "jwt-rotate-guard",
    code: 401,
    message: "Refresh Token Failed",
  },
);
