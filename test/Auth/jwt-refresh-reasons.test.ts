import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { JWTAuthService } from "../../src/auth/jwt/jwt-service";
import { jwtAuth, jwtRefresh } from "../../src/guard/jwt.guard";
import { runGuard } from "../helpers";
import { BareRefreshStore, MemoryRefreshStore } from "./memory-refresh-store";

interface Claims {
  userId: string;
  role: string;
}

const secret = "jwt-reason-regression-secret";
const claims: Claims = { userId: "user-1", role: "member" };

function createService(config = {}) {
  const store = new MemoryRefreshStore();
  const service = new JWTAuthService<Claims>(store, secret, config);

  return { service, store };
}

function refreshRequest(token: string): Request {
  return new Request("http://localhost/refresh", {
    method: "POST",
    headers: { "x-refresh-token": token },
  });
}

async function reasonOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as {
    error?: string;
    error_code?: string;
  };
  return body.error_code;
}

afterEach(() => {
  setSystemTime();
});

describe("refresh-token rejection reasons", () => {
  it("distinguishes reused, expired, and invalid tokens", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service } = createService({ refreshValidity: 7 });

    const issued = await service.issue(claims);

    const first = await service.consumeWithReason(issued.refreshToken);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.claims.userId).toBe("user-1");

    const reused = await service.consumeWithReason(issued.refreshToken);
    expect(reused).toEqual({ ok: false, reason: "reused" });

    expect(await service.consumeWithReason("not-a-jwt")).toEqual({
      ok: false,
      reason: "invalid",
    });

    const expiring = await service.issue(claims);
    setSystemTime(new Date("2026-01-09T00:00:00.000Z"));

    expect(await service.consumeWithReason(expiring.refreshToken)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("adds error_code to the refresh guard 401 while keeping status/message", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service } = createService({ refreshValidity: 7 });

    const issued = await service.issue(claims);

    const accepted = await runGuard(
      jwtRefresh(service),
      refreshRequest(issued.refreshToken),
    );
    expect(accepted.response.status).toBe(200);

    const replay = await runGuard(
      jwtRefresh(service),
      refreshRequest(issued.refreshToken),
    );
    expect(replay.response.status).toBe(401);
    expect(replay.response.headers.get("www-authenticate")).toBe("Bearer");
    const replayBody = (await replay.response.json()) as {
      error: string;
      error_code: string;
    };
    expect(replayBody.error).toBe("Refresh Token Failed");
    expect(replayBody.error_code).toBe("reused");

    const invalid = await runGuard(
      jwtRefresh(service),
      refreshRequest("garbage"),
    );
    expect(invalid.response.status).toBe(401);
    expect(await reasonOf(invalid.response)).toBe("invalid");

    const missing = await runGuard(
      jwtRefresh(service),
      new Request("http://localhost/refresh", { method: "POST" }),
    );
    expect(missing.response.status).toBe(401);
    expect(await reasonOf(missing.response)).toBe("invalid");

    const expiring = await service.issue(claims);
    setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
    const expired = await runGuard(
      jwtRefresh(service),
      refreshRequest(expiring.refreshToken),
    );
    expect(expired.response.status).toBe(401);
    expect(await reasonOf(expired.response)).toBe("expired");
  });

  it("carries WWW-Authenticate on jwtAuth rejections", async () => {
    const { service } = createService();

    const missing = await runGuard(
      jwtAuth(service),
      new Request("http://localhost/"),
    );
    expect(missing.response.status).toBe(401);
    expect(missing.response.headers.get("www-authenticate")).toBe("Bearer");

    const invalid = await runGuard(
      jwtAuth(service),
      new Request("http://localhost/", {
        headers: { authorization: "Bearer nope" },
      }),
    );
    expect(invalid.response.status).toBe(401);
    expect(invalid.response.headers.get("www-authenticate")).toBe("Bearer");
  });
});

describe("JWT lifetimes", () => {
  it("supports a per-call lifetime without changing the minute-based default", () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { service } = createService({ tokenValidity: 15 });

    const shortLived = service.sign(claims, 2);
    expect(service.verify(shortLived)).not.toBeNull();

    setSystemTime(new Date("2026-01-01T00:00:03.000Z"));
    expect(service.verify(shortLived)).toBeNull();

    const defaultLived = service.sign(claims);
    const decoded = service.verify(defaultLived)!;
    expect(decoded.exp - decoded.iat).toBe(15 * 60);

    expect(() => service.sign(claims, 0)).toThrow(RangeError);
    expect(() => service.sign(claims, -1)).toThrow(RangeError);
  });
});

describe("refresh-token cleanup contract", () => {
  it("delegates to an optional deleteExpired hook", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new MemoryRefreshStore();
    const service = new JWTAuthService<Claims>(store, secret);
    const now = Date.now();

    await store.save("expired-token", now - 1_000);
    await store.save("live-token", now + 60_000);

    const removed = await service.deleteExpired(now);
    expect(removed).toBe(1);
    expect(store.tokens.has("expired-token")).toBe(false);
    expect(store.tokens.has("live-token")).toBe(true);
    expect(store.deleteCalls).toEqual([now]);
  });

  it("treats a store without the hook as a no-op", async () => {
    const service = new JWTAuthService<Claims>(new BareRefreshStore(), secret);
    await expect(service.deleteExpired()).resolves.toBeUndefined();
  });
});
