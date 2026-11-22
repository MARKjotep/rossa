import { describe, expect, it } from "bun:test";
import { makeContext } from "../helpers";
import { session } from "../../src/guard/session.guard";
import { MemorySessionAuth } from "./in-memory-session-auth";

const DAY = 86_400_000;

function cookieExpiration(cookie: string): number {
  const match = cookie.match(/Expires=([^;]+)/);
  expect(match).not.toBeNull();
  return Date.parse(match![1]!);
}

describe("session lifetimes", () => {
  it("keeps fractional-day lifetimes in the future across getters, cookie, and isNotExpired", () => {
    const lifetimeDays = 1.5 / 86_400;
    const auth = new MemorySessionAuth({
      SESSION_LIFETIME: lifetimeDays,
      COOKIE_LIFETIME: lifetimeDays,
    });

    const before = Date.now();
    const sessionExpiry = auth.getSessionExpirationDate.getTime();
    const cookieExpiry = auth.getCookieExpirationDate.getTime();
    const after = Date.now();

    expect(sessionExpiry).toBeGreaterThan(before);
    expect(sessionExpiry).toBeGreaterThanOrEqual(before + 1_500);
    expect(sessionExpiry).toBeLessThanOrEqual(after + 1_500 + 5);

    expect(cookieExpiry).toBeGreaterThanOrEqual(before + 1_500);
    expect(cookieExpiry).toBeLessThanOrEqual(after + 1_500 + 5);

    expect(auth.isNotExpired(new Date(sessionExpiry))).toBe(true);
    expect(auth.isNotExpired(new Date(Date.now() - 1))).toBe(false);

    const cookie = auth.buildCookieString(auth.new({}));
    expect(cookieExpiration(cookie)).toBeGreaterThan(Date.now());
    expect(Math.abs(cookieExpiration(cookie) - (Date.now() + 1_500))).toBeLessThan(
      2_000,
    );
  });

  it("leaves whole-day lifetimes unchanged", () => {
    const auth = new MemorySessionAuth({
      SESSION_LIFETIME: 31,
      COOKIE_LIFETIME: 7,
    });

    const now = Date.now();
    expect(
      Math.abs(auth.getSessionExpirationDate.getTime() - (now + 31 * DAY)),
    ).toBeLessThan(100);
    expect(
      Math.abs(auth.getCookieExpirationDate.getTime() - (now + 7 * DAY)),
    ).toBeLessThan(100);

    const cookie = auth.buildCookieString(auth.new({}));
    expect(
      Math.abs(cookieExpiration(cookie) - (Date.now() + 7 * DAY)),
    ).toBeLessThan(2_000);
  });

  it("stores the millisecond expiration so a loaded session is not expired", async () => {
    const auth = new MemorySessionAuth({
      SESSION_LIFETIME: 1.5 / 86_400,
    });
    const guard = session(auth);

    const context = makeContext(new Request("http://localhost/"));
    const response = await guard(context, async () => {
      (context.session as any).userId = "u-1";
      return new Response("ok");
    });

    expect(response.status).toBe(200);
    expect(auth.rows.size).toBe(1);

    const row = [...auth.rows.values()][0]!;
    expect(new Date(row.expiration).getTime()).toBeGreaterThan(Date.now());
  });
});
