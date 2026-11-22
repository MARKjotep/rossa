import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import type { JwtRefreshTokenStore } from "../../src/auth/jwt/jwt-service";
import { JWTAuthService } from "../../src/auth/jwt/jwt-service";
import { jwtRefresh } from "../../src/guard/jwt.guard";
import { runGuard } from "../helpers";

interface Claims {
  userId: string;
  role: string;
}

/** Minimal atomic store: delete-on-read under a single JS thread. */
class MemoryRefreshStore implements JwtRefreshTokenStore {
  public readonly tokens = new Map<string, number>();

  public async save(token: string, expiresAt: number): Promise<void> {
    this.tokens.set(token, expiresAt);
  }

  public async consume(token: string): Promise<boolean> {
    const expiresAt = this.tokens.get(token);
    if (expiresAt === undefined) return false;

    this.tokens.delete(token);
    return expiresAt > Date.now();
  }
}

const secret = "regression-test-secret-for-jwt-refresh-replay";

function createService(store = new MemoryRefreshStore()) {
  const service = new JWTAuthService<Claims>(store, secret, {
    tokenValidity: 15,
    refreshValidity: 7,
  });

  return { service, store };
}

function refreshRequest(token: string): Request {
  return new Request("http://localhost/", {
    headers: { "x-refresh-token": token },
  });
}

afterEach(() => {
  setSystemTime();
});

describe("JWT refresh token uniqueness", () => {
  it("issues distinct token pairs for identical claims in the same clock tick", async () => {
    const { service } = createService();

    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const first = await service.issue({ userId: "user-1", role: "member" });
    const second = await service.issue({ userId: "user-1", role: "member" });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);

    const firstClaims = service.verify(first.accessToken);
    const secondClaims = service.verify(second.accessToken);

    expect(typeof firstClaims?.jti).toBe("string");
    expect(firstClaims?.jti).not.toBe(secondClaims?.jti);
  });

  it("replaces inherited token metadata instead of reusing it", async () => {
    const service = new JWTAuthService<Record<string, any>>(
      new MemoryRefreshStore(),
      secret,
    );

    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const payload = {
      userId: "user-1",
      jti: "stale-identifier",
      iat: 1,
      exp: 2,
    };

    const first = service.sign(payload);
    const second = service.sign(payload);
    const firstClaims = service.verify(first);
    const secondClaims = service.verify(second);

    expect(second).not.toBe(first);
    expect(firstClaims?.jti).not.toBe("stale-identifier");
    expect(secondClaims?.jti).not.toBe("stale-identifier");
    expect(firstClaims?.jti).not.toBe(secondClaims?.jti);
    expect(firstClaims?.exp).toBeGreaterThan(2);
  });
});

describe("JWT refresh token single use", () => {
  it("consumes a refresh token exactly once", async () => {
    const { service, store } = createService();

    const issued = await service.issue({ userId: "user-1", role: "member" });
    expect(store.tokens.has(issued.refreshToken)).toBe(true);

    const claims = await service.consume(issued.refreshToken);
    expect(claims?.userId).toBe("user-1");
    expect(store.tokens.has(issued.refreshToken)).toBe(false);

    expect(await service.consume(issued.refreshToken)).toBeNull();
  });

  it("rotates to a different refresh token and rejects replay under a frozen clock", async () => {
    const { service } = createService();

    // The original bug only surfaced when the clock did not advance between
    // issue and rotation, so keep it frozen for the whole loop.
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const first = await service.issue({ userId: "user-1", role: "member" });
    const consumed = await service.consume(first.refreshToken);
    expect(consumed).not.toBeNull();

    const rotated = await service.issue(consumed!);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    // Replaying the consumed token must fail even though its signature is valid.
    expect(await service.consume(first.refreshToken)).toBeNull();

    // The replacement is itself single use.
    expect(await service.consume(rotated.refreshToken)).not.toBeNull();
    expect(await service.consume(rotated.refreshToken)).toBeNull();
  });
});

describe("JWT refresh guard rotation", () => {
  it("accepts the first refresh, replaces the token, and rejects a replay", async () => {
    const { service } = createService();

    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const issued = await service.issue({ userId: "user-1", role: "member" });

    const refreshed = await runGuard(
      jwtRefresh(service),
      refreshRequest(issued.refreshToken),
    );
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.nextCalls).toBe(1);

    const tokens = refreshed.context.data.jwtTokens as {
      accessToken: string;
      refreshToken: string;
    };
    expect(tokens.refreshToken).not.toBe(issued.refreshToken);
    expect(service.verify(tokens.accessToken)?.userId).toBe("user-1");

    const replay = await runGuard(
      jwtRefresh(service),
      refreshRequest(issued.refreshToken),
    );
    expect(replay.response.status).toBe(401);
    expect(replay.nextCalls).toBe(0);
  });
});

describe("JWT access token compatibility", () => {
  it("still verifies claims, lifetime, and tamper rejection", async () => {
    const { service } = createService();
    const token = service.sign({ userId: "user-42", role: "admin" });
    const claims = service.verify(token);

    expect(claims?.userId).toBe("user-42");
    expect(claims?.role).toBe("admin");
    expect(claims).not.toBeNull();
    expect(claims!.exp - claims!.iat).toBe(15 * 60);

    const tampered = `${token.slice(0, -2)}xx`;
    expect(service.verify(tampered)).toBeNull();
    expect(service.verify("not-a-token")).toBeNull();
  });
});
