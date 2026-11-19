import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { gunzipSync } from "node:zlib";
import { csrf } from "../../src/guard/csrf.guard";
import { smartCache } from "../../src/guard/cache.guard";
import { errorHandler } from "../../src/guard/error.guard";
import { ipFilter } from "../../src/guard/ip.guard";
import { logger, loggerFN } from "../../src/guard/logger.guard";
import { IpMatcher } from "../../src/guard/shared/ip-matcher";
import { RateStore } from "../../src/guard/shared/rate-store";
import { rateLimit } from "../../src/guard/rate.guard";
import { timeout } from "../../src/guard/timeout.guard";
import { validateUrl } from "../../src/guard/url.guard";
import { makeContext, runGuard } from "../helpers";

afterEach(() => RateStore.clear());

describe("security and pipeline guards", () => {
  it("checks CSRF tokens only on unsafe methods without logging secrets", async () => {
    const log = spyOn(console, "log");
    const guard = csrf();

    const safe = await runGuard(guard, new Request("http://localhost/"));
    expect(safe.response.status).toBe(200);

    const valid = await runGuard(
      guard,
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          cookie: "csrf_token=secret-token",
          "x-csrf-token": "secret-token",
        },
      }),
    );
    expect(valid.response.status).toBe(200);

    const invalid = await runGuard(
      guard,
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          cookie: "csrf_token=expected",
          "x-csrf-token": "attacker-value",
        },
      }),
    );
    expect(invalid.response.status).toBe(403);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("enforces strict IPv4 allowlists, denylist precedence, CIDR and wildcards", async () => {
    const whitelist = ipFilter({ whitelist: ["192.168.1.0/24"] });
    const allowed = await runGuard(
      whitelist,
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "192.168.1.42" },
      }),
    );
    expect(allowed.response.status).toBe(200);

    const notAllowed = await runGuard(
      whitelist,
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      }),
    );
    expect(notAllowed.response.status).toBe(403);

    const denyWins = await runGuard(
      ipFilter({
        whitelist: ["192.168.1.*"],
        blacklist: ["192.168.1.42"],
      }),
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "192.168.1.42" },
      }),
    );
    expect(denyWins.response.status).toBe(403);

    const proxyContext = makeContext(
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "192.168.1.42" },
      }),
      { server: { requestIP: () => ({ address: "203.0.113.9" }) } },
    );
    const directAddressRule = await ipFilter({ whitelist: ["203.0.113.9"] })(
      proxyContext,
      () => new Response("ok"),
    );
    expect(directAddressRule.status).toBe(200);

    expect(new IpMatcher(["10.0.*.*"]).test("10.0.2.4")).toBe(true);
    expect(new IpMatcher(["10.0.0.0/8"]).test("10.255.2.4")).toBe(true);
    expect(new IpMatcher(["10.0.0.0/8"]).test("10.255.2.4x")).toBe(false);
    expect(() => new IpMatcher(["999.0.0.1"])).toThrow(RangeError);
    expect(() => new IpMatcher(["10.0.0.0/33"])).toThrow(RangeError);
  });

  it("rate limits by address, method, and path and emits headers", async () => {
    const guard = rateLimit({ max: 1, windowMs: 60_000 });
    const makeRequest = () =>
      new Request("http://localhost/limited", {
        headers: { "x-forwarded-for": "198.51.100.10" },
      });

    const first = await runGuard(guard, makeRequest());
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get("x-ratelimit-limit")).toBe("1");
    expect(first.response.headers.get("x-ratelimit-remaining")).toBe("0");

    const second = await runGuard(guard, makeRequest());
    expect(second.response.status).toBe(429);
    expect(second.response.headers.get("retry-after")).not.toBeNull();
  });

  it("caches by full URL but bypasses credentials and private responses", async () => {
    const guard = smartCache({ ttlMs: 60_000 });
    let calls = 0;
    const request = async (url: string, headers: HeadersInit = {}) => {
      return guard(makeContext(new Request(url, { headers })), async () => {
        calls += 1;
        if (url.endsWith("/no-store")) {
          return new Response(`private:${calls}`, {
            headers: { "cache-control": "private" },
          });
        }
        if (url.endsWith("/vary")) {
          return new Response(`vary:${calls}`, {
            headers: { vary: "accept-language" },
          });
        }
        if (url.endsWith("/zero-age")) {
          return new Response(`zero-age:${calls}`, {
            headers: { "cache-control": "max-age=0" },
          });
        }
        return new Response(`${url}:${new Headers(headers).get("authorization")}:${calls}`);
      });
    };

    const first = await request("http://localhost/cache?item=one");
    const firstBody = await first.text();
    const same = await request("http://localhost/cache?item=one");
    expect(await same.text()).toBe(firstBody);
    expect(calls).toBe(1);

    await request("http://localhost/cache?item=two");
    expect(calls).toBe(2);

    const authOne = await request("http://localhost/private", {
      authorization: "Bearer user-one",
    });
    const authTwo = await request("http://localhost/private", {
      authorization: "Bearer user-two",
    });
    expect(await authOne.text()).not.toBe(await authTwo.text());

    const privateOne = await request("http://localhost/no-store");
    const privateTwo = await request("http://localhost/no-store");
    expect(await privateOne.text()).not.toBe(await privateTwo.text());

    const varyOne = await request("http://localhost/vary");
    const varyTwo = await request("http://localhost/vary");
    expect(await varyOne.text()).not.toBe(await varyTwo.text());

    const zeroAgeOne = await request("http://localhost/zero-age");
    const zeroAgeTwo = await request("http://localhost/zero-age");
    expect(await zeroAgeOne.text()).not.toBe(await zeroAgeTwo.text());
    expect(calls).toBe(10);
  });

  it("logs before and after downstream work with the documented logger guards", async () => {
    const log = spyOn(console, "log");
    log.mockImplementation((...args: any[]) => {
      void args;
    });
    try {
      const context = makeContext(new Request("http://localhost/logged", { method: "POST" }));
      const before = logger("test-label");
      await before(context, () => new Response("ok"));
      expect(log.mock.calls[0]?.[0]).toContain("POST /logged");
      expect(log.mock.calls[0]?.[0]).toContain("test-label");

      const formatter = loggerFN(({ method, url }) => `${method} ${url}`);
      await formatter(context, () => new Response("ok"));
      expect(log.mock.calls[1]?.[0]).toBe("POST /logged");
    } finally {
      log.mockRestore();
    }
  });

  it("rejects malformed and unsafe URLs and accepts allowed query rules", async () => {
    const guard = validateUrl({
      allowedKeys: ["page"],
      noDuplicates: true,
      patterns: { page: /^\d+$/ },
      sanitizePaths: true,
    });

    const valid = await runGuard(guard, new Request("http://localhost/search?page=2"));
    expect(valid.response.status).toBe(200);

    const duplicate = await runGuard(guard, new Request("http://localhost/search?page=1&page=2"));
    expect(duplicate.response.status).toBe(400);

    const badPattern = await runGuard(guard, new Request("http://localhost/search?page=x"));
    expect(badPattern.response.status).toBe(400);

    const traversal = await runGuard(guard, new Request("http://localhost/%252e%252e/private"));
    expect(traversal.response.status).toBe(400);

    const tooLong = await runGuard(
      validateUrl({ maxUrlLength: 30 }),
      new Request(`http://localhost/${"a".repeat(40)}`),
    );
    expect(tooLong.response.status).toBe(414);
  });

  it("catches downstream errors and applies request timeouts", async () => {
    const errorResponse = await errorHandler({ message: "safe" })(
      makeContext(new Request("http://localhost/")),
      async () => {
        throw new Error("private failure details");
      },
    );
    expect(errorResponse.status).toBe(500);
    const errorBody = await errorResponse.text();
    expect(errorBody).toContain("safe");
    expect(errorBody).not.toContain("private failure details");

    const preservedError = await errorHandler({ message: "application error" })(
      makeContext(new Request("http://localhost/")),
      () =>
        timeout(100)(
          makeContext(new Request("http://localhost/")),
          async () => {
            throw new Error("handler failed");
          },
        ),
    );
    expect(preservedError.status).toBe(500);
    expect(await preservedError.text()).toContain("application error");

    const timed = await timeout(2)(
      makeContext(new Request("http://localhost/")),
      async () => {
        await Bun.sleep(15);
        return new Response("late");
      },
    );
    expect(timed.status).toBe(408);
    await Bun.sleep(20);
  });
});
