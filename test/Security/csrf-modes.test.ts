import { describe, expect, it } from "bun:test";
import { csrf } from "../../src/guard/csrf.guard";
import { urlencoded } from "../../src/guard/urlencoded.guard";
import { makeContext, runGuard } from "../helpers";

const ERROR_BODY = {
  success: false,
  error: "CSRF Token Validation Failed",
};

function setCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") {
    return withGetter.getSetCookie();
  }
  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

function jsonPost(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/form", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function formPost(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/form", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
}

describe("csrf double-submit mode", () => {
  it("accepts a matching JSON body token", async () => {
    const guard = csrf({ mode: "double-submit" });
    const { response, nextCalls } = await runGuard(
      guard,
      jsonPost(
        { csrf_token: "token-1" },
        { cookie: "csrf_token=token-1" },
      ),
    );

    expect(response.status).toBe(200);
    expect(nextCalls).toBe(1);
  });

  it("accepts a matching url-encoded form token and leaves the body readable", async () => {
    const guard = csrf({ mode: "double-submit" });
    const parser = urlencoded();
    const context = makeContext(
      formPost("csrf_token=token-1", { cookie: "csrf_token=token-1" }),
    );

    const response = await guard(context, () =>
      parser(context, async () =>
        context.res.json({ token: context.form.csrf_token }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "token-1" });
  });

  it("honours a custom body field", async () => {
    const guard = csrf({ mode: "double-submit", bodyField: "_token" });
    const accepted = await runGuard(
      guard,
      formPost("_token=token-1", { cookie: "csrf_token=token-1" }),
    );
    expect(accepted.response.status).toBe(200);

    const rejected = await runGuard(
      guard,
      formPost("csrf_token=token-1", { cookie: "csrf_token=token-1" }),
    );
    expect(rejected.response.status).toBe(403);
  });

  it("rejects a mismatched body token", async () => {
    const guard = csrf({ mode: "double-submit" });
    const { response, nextCalls } = await runGuard(
      guard,
      jsonPost(
        { csrf_token: "attacker" },
        { cookie: "csrf_token=token-1" },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ERROR_BODY);
    expect(nextCalls).toBe(0);
  });

  it("rejects when the cookie is missing", async () => {
    const guard = csrf({ mode: "double-submit" });
    const { response, nextCalls } = await runGuard(
      guard,
      jsonPost({ csrf_token: "token-1" }),
    );

    expect(response.status).toBe(403);
    expect(nextCalls).toBe(0);
  });

  it("rejects when the body token is missing", async () => {
    const guard = csrf({ mode: "double-submit" });
    const { response, nextCalls } = await runGuard(
      guard,
      jsonPost({ other: "value" }, { cookie: "csrf_token=token-1" }),
    );

    expect(response.status).toBe(403);
    expect(nextCalls).toBe(0);
  });

  it("rejects a supplied mismatched header even when the body matches", async () => {
    const guard = csrf({ mode: "double-submit" });
    const mismatched = await runGuard(
      guard,
      jsonPost(
        { csrf_token: "token-1" },
        { cookie: "csrf_token=token-1", "x-csrf-token": "attacker" },
      ),
    );
    expect(mismatched.response.status).toBe(403);

    const matched = await runGuard(
      guard,
      jsonPost(
        { csrf_token: "token-1" },
        { cookie: "csrf_token=token-1", "x-csrf-token": "token-1" },
      ),
    );
    expect(matched.response.status).toBe(200);
  });

  it("leaves safe methods untouched", async () => {
    const guard = csrf({ mode: "double-submit" });
    const { response, nextCalls } = await runGuard(
      guard,
      new Request("http://localhost/form"),
    );

    expect(response.status).toBe(200);
    expect(nextCalls).toBe(1);
  });
});

describe("csrf header mode", () => {
  it("keeps the existing header contract", async () => {
    const guard = csrf();

    const accepted = await runGuard(
      guard,
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          cookie: "csrf_token=token-1",
          "x-csrf-token": "token-1",
        },
      }),
    );
    expect(accepted.response.status).toBe(200);

    const rejected = await runGuard(
      guard,
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          cookie: "csrf_token=token-1",
          "x-csrf-token": "attacker",
        },
      }),
    );
    expect(rejected.response.status).toBe(403);
    expect(await rejected.response.json()).toEqual(ERROR_BODY);
  });
});

describe("csrf token minting", () => {
  it("issues one readable Set-Cookie and returns the token", async () => {
    const context = makeContext(new Request("http://localhost/api/csrf"));
    const issued = csrf.issue(context);

    expect(typeof issued.token).toBe("string");
    expect(issued.token.length).toBeGreaterThan(0);
    expect(issued.cookie).toBe(
      `csrf_token=${issued.token}; Path=/; SameSite=Lax`,
    );

    const response = context.res.json({ csrfToken: issued.token });
    const cookies = setCookieHeaders(response.headers);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toBe(issued.cookie);
    expect(cookies[0]).not.toContain("HttpOnly");
    expect(await response.json()).toEqual({ csrfToken: issued.token });
  });

  it("csrf.token writes the same cookie and returns just the value", () => {
    const context = makeContext(new Request("http://localhost/api/csrf"));
    const token = csrf.token(context);
    const response = context.res.text("ok");
    const cookies = setCookieHeaders(response.headers);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toBe(`csrf_token=${token}; Path=/; SameSite=Lax`);
  });

  it("accepts a cookie name, explicit value, and cookie flags", () => {
    const context = makeContext(new Request("http://localhost/api/csrf"));
    const issued = csrf.issue(context, {
      cookieName: "xsrf",
      value: "fixed-token",
      httpOnly: true,
      secure: true,
      maxAge: 60,
    });

    expect(issued.token).toBe("fixed-token");
    expect(issued.cookie).toBe(
      "xsrf=fixed-token; Max-Age=60; Secure; HttpOnly; Path=/; SameSite=Lax",
    );

    const cookies = setCookieHeaders(context.res.text("ok").headers);
    expect(cookies).toEqual([issued.cookie]);
  });
});
