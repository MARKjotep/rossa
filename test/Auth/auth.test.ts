import { describe, expect, it } from "bun:test";
import {
  auth,
  authBearer,
  apiKey,
  authorize,
} from "../../src/guard/auth.guard";
import { jwtAuth, jwtRefresh } from "../../src/guard/jwt.guard";
import { session } from "../../src/guard/session.guard";
import type { SessionAuthInterface } from "../../src/auth/session/auth-interface";
import { ServerSide } from "../../src/auth/session/server-side";
import type { JWTAuthService } from "../../src/auth/jwt/jwt-service";
import { jsonRequest, makeContext, runGuard } from "../helpers";

describe("authentication and authorization guards", () => {
  // ---  ---------------------------------------------------------------

  it("accepts a bearer token and rejects malformed or invalid tokens", async () => {
    const validate = async (_ctx: unknown, token?: string) => token === "valid";
    const guard = authBearer(validate);

    const accepted = await runGuard(
      guard,
      new Request("http://localhost/", {
        headers: { authorization: "bEaReR   valid" },
      }),
    );
    expect(accepted.response.status).toBe(200);
    expect(accepted.nextCalls).toBe(1);

    for (const authorization of [
      undefined,
      "Basic valid",
      "Bearer",
      "Bearer valid extra",
    ]) {
      const headers = authorization ? { authorization } : {};
      const rejected = await runGuard(
        guard,
        new Request("http://localhost/", { headers }),
      );
      expect(rejected.response.status).toBe(401);
      expect(rejected.nextCalls).toBe(0);
    }
  });

  // ---  ---------------------------------------------------------------

  it("validates API keys and multiple header validators", async () => {
    const apiKeyGuard = apiKey((_ctx, key) => key === "secret");
    const accepted = await runGuard(
      apiKeyGuard,
      new Request("http://localhost/", { headers: { "x-api-key": "secret" } }),
    );
    expect(accepted.response.status).toBe(200);

    const missing = await runGuard(
      apiKeyGuard,
      new Request("http://localhost/"),
    );
    expect(missing.response.status).toBe(401);

    const multiHeader = auth({
      "x-tenant": (_ctx, value) => value === "tenant-a",
      "x-role": (_ctx, value) => value === "admin",
    });
    const allowed = await runGuard(
      multiHeader,
      new Request("http://localhost/", {
        headers: { "x-tenant": "tenant-a", "x-role": "admin" },
      }),
    );
    expect(allowed.response.status).toBe(200);

    const denied = await runGuard(
      multiHeader,
      new Request("http://localhost/", {
        headers: { "x-tenant": "tenant-a", "x-role": "user" },
      }),
    );
    expect(denied.response.status).toBe(401);
  });

  it("applies authorization policy to session identity", async () => {
    const request = new Request("http://localhost/");
    const context = makeContext(request);
    context.session = { userId: "u1" } as any;
    const policy = authorize((ctx) => (ctx.session as any)?.userId === "u1");
    const permitted = await runGuard(policy, request, context);
    expect(permitted.response.status).toBe(200);

    context.session = { userId: "u2" } as any;
    const forbidden = await runGuard(policy, request, context);
    expect(forbidden.response.status).toBe(403);
  });

  it("stores assigned session properties and emits a cookie", async () => {
    const nativeRequest = new Request("http://localhost/");
    let receivedRequest: unknown;
    const state = new ServerSide().session;
    let savedSession: any;
    const service = {
      loadHeader: async (request: Request) => {
        receivedRequest = request;
        return [undefined, state];
      },
      saveSession: async (currentSession: unknown, headers: Headers) => {
        savedSession = currentSession;
        headers.append("set-cookie", "session=test-session");
      },
      deleteSession: async () => {},
    } as unknown as SessionAuthInterface;

    const context = makeContext(nativeRequest);
    const result = await session(service)(context, async () => {
      (context.session as any).email = "user@example.com";
      return new Response("saved", { status: 200 });
    });
    expect(receivedRequest).toBeInstanceOf(Request);
    expect(result.status).toBe(200);
    expect((context.session as any).email).toBe("user@example.com");
    expect(savedSession).toBe(state);
    expect(result.headers.get("set-cookie")).toContain("session=test-session");
  });

  it("verifies access tokens and atomically refreshes token pairs", async () => {
    const service = {
      verify: (token: string) =>
        token === "access" ? { sub: "user-1", role: "member" } : null,
      consume: async (token: string) =>
        token === "refresh" ? { sub: "user-1", role: "member" } : null,
      issue: async () => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
      }),
    } as unknown as JWTAuthService<any>;

    const access = await runGuard(
      jwtAuth(service),
      new Request("http://localhost/", {
        headers: { authorization: "Bearer access" },
      }),
    );
    expect(access.response.status).toBe(200);
    expect(access.context.jwtData.sub).toBe("user-1");

    const invalid = await runGuard(
      jwtAuth(service),
      new Request("http://localhost/", {
        headers: { authorization: "Bearer bad" },
      }),
    );
    expect(invalid.response.status).toBe(401);

    const refreshed = await runGuard(
      jwtRefresh(service),
      new Request("http://localhost/", {
        headers: { "x-refresh-token": "refresh" },
      }),
    );
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.context.data.jwtTokens).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });

    const replay = await runGuard(
      jwtRefresh(service),
      new Request("http://localhost/", {
        headers: { "x-refresh-token": "invalid token" },
      }),
    );
    expect(replay.response.status).toBe(401);
  });
});
