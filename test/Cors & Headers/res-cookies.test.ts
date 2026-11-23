import { describe, expect, it } from "bun:test";
import { Heder } from "../../src/http/headr";
import { session } from "../../src/guard/session.guard";
import { makeContext } from "../helpers";
import { MemorySessionAuth } from "../Auth/in-memory-session-auth";

function setCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") {
    return withGetter.getSetCookie();
  }
  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

describe("res.setCookie", () => {
  it("appends one Set-Cookie header per call", () => {
    const context = makeContext(new Request("http://localhost/cookies"));

    context.res.setCookie("first", "1", { path: "/", httpOnly: true });
    context.res.setCookie("second", "2", { path: "/", sameSite: "Lax" });

    const response = context.res.text("ok");
    const cookies = setCookieHeaders(response.headers);

    expect(cookies).toHaveLength(2);
    expect(cookies).toEqual([
      "first=1; HttpOnly; Path=/",
      "second=2; Path=/; SameSite=Lax",
    ]);
  });

  it("defaults Path to / and sanitizes control characters", () => {
    const context = makeContext(new Request("http://localhost/cookies"));
    context.res.setCookie("token", "abc\r\nX-Evil: injected");

    const response = context.res.text("ok");
    const cookies = setCookieHeaders(response.headers);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toBe("token=abcX-Evil: injected; Path=/");
    expect(response.headers.get("x-evil")).toBeNull();
  });

  it("keeps cookies written through res.header alongside direct writes", () => {
    const context = makeContext(new Request("http://localhost/cookies"));

    context.res.header(
      new Heder().cookie("legacy", "v", {
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
      }),
    );
    context.res.setCookie("theme", "dark", { path: "/" });

    const response = context.res.json({ ok: true });
    const cookies = setCookieHeaders(response.headers);

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("legacy=v");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Strict");
    expect(cookies[1]).toBe("theme=dark; Path=/");
  });
});

describe("res.clearCookie", () => {
  it("emits Max-Age=0 with an epoch Expires", () => {
    const context = makeContext(new Request("http://localhost/cookies"));

    context.res.setCookie("theme", "dark", { path: "/" });
    context.res.clearCookie("theme", { path: "/" });

    const cookies = setCookieHeaders(context.res.text("ok").headers);

    expect(cookies).toHaveLength(2);
    expect(cookies[1]).toBe(
      "theme=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/",
    );
  });
});

describe("session cookie contract", () => {
  it("stays unchanged when handlers also set direct cookies", async () => {
    const auth = new MemorySessionAuth({ COOKIE_SECURE: false });
    const guard = session(auth);
    const context = makeContext(new Request("http://localhost/login"));

    const response = await guard(context, async () => {
      (context.session as any).email = "user@example.com";
      context.res.setCookie("theme", "dark", { path: "/" });
      return context.res.json({ ok: true });
    });

    expect(response.status).toBe(200);

    const cookies = setCookieHeaders(response.headers);
    expect(cookies).toHaveLength(2);

    const sessionCookie = cookies.find((cookie) => cookie.startsWith("session="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(
      /^session=[^;]+; Path=\/; Expires=.*; HttpOnly; SameSite=Lax$/,
    );
    expect(sessionCookie).not.toContain("Max-Age");

    expect(cookies.find((cookie) => cookie.startsWith("theme="))).toBe(
      "theme=dark; Path=/",
    );
  });
});
