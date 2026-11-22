import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { JWTAuthService } from "../../src/auth/jwt/jwt-service";
import {
  jwtAuth,
  jwtRefresh,
  jwtRotate,
} from "../../src/guard/jwt.guard";
import { makeContext, runGuard } from "../helpers";
import { MemoryRefreshStore } from "./memory-refresh-store";

interface Claims {
  userId: string;
  role: "admin" | "member";
}

const secret = "jwt-rotate-regression-secret";
const claims: Claims = { userId: "user-1", role: "member" };

function createService() {
  const store = new MemoryRefreshStore();
  const service = new JWTAuthService<Claims>(store, secret, {
    tokenValidity: 0.05,
    refreshValidity: 7,
  });

  return { service, store };
}

function combinedRequest(access: string, refresh: string): Request {
  return new Request("http://localhost/rotate", {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "x-refresh-token": refresh,
    },
  });
}

afterEach(() => {
  setSystemTime();
});

describe("combined JWT routes", () => {
  it("keeps access claims in ctx.jwtData when jwtAuth runs before jwtRefresh", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service } = createService();
    const pair = await service.issue(claims);
    const context = makeContext(combinedRequest(pair.accessToken, pair.refreshToken));

    const accessResponse = await jwtAuth(service)(context, async () => {
      return new Response("ok");
    });
    expect(accessResponse.status).toBe(200);

    const accessJti = context.jwtData.jti;
    expect(typeof accessJti).toBe("string");

    const refreshResponse = await jwtRefresh(service)(context, async () => {
      return new Response("rotated");
    });

    expect(refreshResponse.status).toBe(200);
    expect(context.jwtData.jti).toBe(accessJti);
    expect(context.data.jwtRefreshData.userId).toBe("user-1");
    expect(context.data.jwtRefreshData.jti).not.toBe(accessJti);
  });

  it("does not burn the refresh token on a refresh-first route when access auth fails", async () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    setSystemTime(startedAt);
    const { service, store } = createService();
    const pair = await service.issue(claims);

    // Access token (3 s) expired; refresh token (7 d) still valid.
    setSystemTime(new Date(startedAt.getTime() + 4_000));

    const result = await runGuard(
      jwtRefresh(service),
      combinedRequest(pair.accessToken, pair.refreshToken),
    );

    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("www-authenticate")).toBe("Bearer");
    expect(result.nextCalls).toBe(0);
    expect(store.tokens.has(pair.refreshToken)).toBe(true);

    // With a fresh access token the same refresh token still rotates.
    const freshAccess = service.sign(claims);
    const retried = await runGuard(
      jwtRefresh(service),
      combinedRequest(freshAccess, pair.refreshToken),
    );

    expect(retried.response.status).toBe(200);
    expect(store.tokens.has(pair.refreshToken)).toBe(false);
    expect(retried.context.data.jwtTokens.accessToken).toBeTruthy();
  });
});

describe("jwtRotate", () => {
  it("rotates with a valid access token while keeping access claims in ctx.jwtData", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service, store } = createService();
    const pair = await service.issue(claims);
    const context = makeContext(combinedRequest(pair.accessToken, pair.refreshToken));

    const accessJti = service.verify(pair.accessToken)!.jti;
    let nextCalls = 0;
    const response = await jwtRotate(service)(context, async () => {
      nextCalls += 1;
      return Response.json(context.data.jwtTokens);
    });

    expect(response.status).toBe(200);
    expect(nextCalls).toBe(1);
    expect(context.jwtData.jti).toBe(accessJti);
    expect(context.data.jwtRefreshData.jti).not.toBe(accessJti);

    const tokens = context.data.jwtTokens as {
      accessToken: string;
      refreshToken: string;
    };
    expect(tokens.refreshToken).not.toBe(pair.refreshToken);
    expect(store.tokens.has(pair.refreshToken)).toBe(false);
    expect(store.tokens.has(tokens.refreshToken)).toBe(true);
    expect(service.verify(tokens.accessToken)?.userId).toBe("user-1");
  });

  it("does not consume the refresh token when the supplied access token is expired", async () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    setSystemTime(startedAt);
    const { service, store } = createService();
    const pair = await service.issue(claims);

    setSystemTime(new Date(startedAt.getTime() + 4_000));

    const result = await runGuard(
      jwtRotate(service),
      combinedRequest(pair.accessToken, pair.refreshToken),
    );

    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("www-authenticate")).toBe("Bearer");
    expect(result.nextCalls).toBe(0);
    expect(store.tokens.has(pair.refreshToken)).toBe(true);
  });

  it("rejects a malformed access token without consuming the refresh token", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service, store } = createService();
    const pair = await service.issue(claims);

    const result = await runGuard(
      jwtRotate(service),
      combinedRequest("not-a-token", pair.refreshToken),
    );

    expect(result.response.status).toBe(401);
    expect(store.tokens.has(pair.refreshToken)).toBe(true);
  });

  it("rotates refresh-only requests and exposes the refresh claims", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service, store } = createService();
    const pair = await service.issue(claims);

    const result = await runGuard(
      jwtRotate(service),
      new Request("http://localhost/rotate", {
        method: "POST",
        headers: { "x-refresh-token": pair.refreshToken },
      }),
    );

    expect(result.response.status).toBe(200);
    expect(result.context.jwtData.userId).toBe("user-1");
    expect(result.context.data.jwtRefreshData.userId).toBe("user-1");
    expect(store.tokens.has(pair.refreshToken)).toBe(false);
  });

  it("reports an invalid reason when the refresh token is missing", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service } = createService();
    const freshAccess = service.sign(claims);

    const result = await runGuard(
      jwtRotate(service),
      new Request("http://localhost/rotate", {
        method: "POST",
        headers: { authorization: `Bearer ${freshAccess}` },
      }),
    );

    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error_code?: string };
    expect(body.error_code).toBe("invalid");
  });
});
