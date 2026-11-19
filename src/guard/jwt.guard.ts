import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";
import type { JWTAuthService } from "@/auth/jwt/jwt-service";

/**
 * Verifies a Bearer access token and stores its decoded claims in `ctx.jwtData`.
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

    const match = authHeader?.trim().match(/^Bearer\s+(\S+)$/i);
    if (!match) return sendError(errorConfig);

    const decodedPayload = service.verify(match[1]!);

    if (!decodedPayload) {
      return sendError(errorConfig);
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
 * the authenticated claims in `ctx.jwtData` and the new tokens in
 * `ctx.data.jwtTokens`.
 *
 * @param service - JWT service used to consume and issue tokens.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
export const jwtRefresh = createGuard<JWTAuthService<any>>(
  async (ctx, next, service, errorConfig) => {
    if (!service) {
      throw new Error("jwtRefresh requires a JWTAuthService instance.");
    }

    const refreshToken = ctx.req.headers.get("x-refresh-token")?.trim();
    if (!refreshToken || /\s/.test(refreshToken)) return sendError(errorConfig);

    // The service validates the signature and atomically consumes the stored token.
    const claims = await service.consume(refreshToken);

    if (!claims) return sendError(errorConfig);

    ctx.jwtData = claims;
    ctx.data.jwtTokens = await service.issue(claims);

    return await next();
  },
  {
    id: "jwt-refresh-guard",
    code: 401,
    message: "Refresh Token Failed",
  },
);
