import { describe, expect, it } from "bun:test";
import { Methods, Rossa, type ctx, route } from "../../src/index";
import { isLocalRedirectTarget } from "../../src/http/res/res.http";
import { makeContext } from "../helpers";

/** Probes from the B1 report: every one previously escaped as a verbatim redirect. */
const UNSAFE_TARGETS = [
  "https://evil.test",
  "http://evil.test/path",
  "//evil.test",
  "///evil.test",
  "\\evil.test",
  "\\\\evil.test",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "/%2f%2fevil.test",
  "/%252f%252fevil.test",
  "/%5c%5cevil.test",
  "/%25252f%25252fevil.test",
  "%2f%2fevil.test",
  "%252f%252fevil.test",
  "",
  "   ",
  " dashboard",
  "/next\r\nSet-Cookie: injected=1\r\nX-Injected: 1",
];

const SAFE_TARGETS = [
  "/",
  "/dashboard",
  "/account?id=1&tab=prefs",
  "/users/42?tab=settings",
  "/login?next=%2Fdashboard",
  "/files/100%25",
  "/docs#install",
];

/** Safe bare relatives: emitted as normalized root-relative paths. */
const BARE_TARGETS: Array<[string, string]> = [
  ["dashboard", "/dashboard"],
  ["?q=1", "/?q=1"],
  ["#install", "/#install"],
  ["users/42?tab=settings", "/users/42?tab=settings"],
];

/** Absolute http(s) URLs accepted by the explicit external escape hatch. */
const EXTERNAL_TARGETS = [
  "https://accounts.example.com/oauth/authorize?client_id=app",
  "http://localhost:3000/callback?code=abc",
  "HTTPS://Example.Test/Next",
];

/** Anything that must not leave the current origin through `redirectExternal`. */
const EXTERNAL_UNSAFE_TARGETS = [
  "//evil.test",
  "///evil.test",
  "\\evil.test",
  "\\\\evil.test",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "ftp://evil.test/file",
  "/dashboard",
  "/account?id=1",
  "dashboard",
  "?q=1",
  "",
  "   ",
  "https://evil.test\r\nSet-Cookie: injected=1",
];

@route("/redirect-local")
class RedirectLocalController extends Methods {
  get({ req, res }: ctx) {
    return res.redirectLocal(String(req.query.to ?? ""));
  }
}

@route("/redirect")
class RedirectController extends Methods {
  get({ req, res }: ctx) {
    return res.redirect(String(req.query.to ?? ""));
  }
}

@route("/redirect-external")
class RedirectExternalController extends Methods {
  get({ req, res }: ctx) {
    return res.redirectExternal(String(req.query.to ?? ""));
  }
}

const makeRes = () => makeContext(new Request("http://localhost/go")).res;

const invalidRedirect = async (response: Response) => {
  expect(response.status).toBe(400);
  expect(response.headers.has("location")).toBe(false);
  expect(await response.json()).toEqual({
    success: false,
    error: "Invalid redirect target",
  });
};

describe("isLocalRedirectTarget", () => {
  it("rejects every absolute, protocol-relative, scheme, and encoded-authority probe", () => {
    for (const target of UNSAFE_TARGETS) {
      expect(isLocalRedirectTarget(target)).toBe(false);
    }
  });

  it("accepts legitimate origin-relative targets", () => {
    for (const target of SAFE_TARGETS) {
      expect(isLocalRedirectTarget(target)).toBe(true);
    }
  });

  it("accepts bare relatives that normalize to a root-relative path", () => {
    for (const [target] of BARE_TARGETS) {
      expect(isLocalRedirectTarget(target)).toBe(true);
    }
  });

  it("rejects non-strings without throwing", () => {
    expect(isLocalRedirectTarget(undefined as unknown as string)).toBe(false);
    expect(isLocalRedirectTarget(null as unknown as string)).toBe(false);
  });
});

describe("res.redirect", () => {
  it("rejects every unsafe probe with 400, no Location, and the documented body", async () => {
    for (const target of UNSAFE_TARGETS) {
      await invalidRedirect(makeRes().redirect(target));
    }
  });

  it("keeps a 302 Location for legitimate origin-relative targets", () => {
    for (const target of SAFE_TARGETS) {
      const response = makeRes().redirect(target);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(target);
    }
  });

  it("normalizes safe bare relatives instead of rejecting them", () => {
    for (const [target, expected] of BARE_TARGETS) {
      const response = makeRes().redirect(target);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("honors a custom redirect status", () => {
    const response = makeRes().redirect("/moved", 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/moved");
  });

  it("does not echo a stale Location header on rejection", async () => {
    const builder = makeRes();
    builder.header({ Location: "/stale" });
    const response = builder.redirect("//evil.test");
    await invalidRedirect(response);
  });

  it("is wired through a route handler and blocks user-supplied external targets", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(RedirectController);

    const safe = await app.test(
      new Request(
        `http://localhost/redirect?to=${encodeURIComponent("dashboard")}`,
      ),
    );
    expect(safe.status).toBe(302);
    expect(safe.headers.get("location")).toBe("/dashboard");

    const unsafe = await app.test(
      new Request(
        `http://localhost/redirect?to=${encodeURIComponent("https://evil.test")}`,
      ),
    );
    await invalidRedirect(unsafe);
  });
});

describe("res.redirectLocal", () => {
  it("answers 400 with the documented body and no Location for unsafe targets", async () => {
    for (const target of UNSAFE_TARGETS) {
      await invalidRedirect(makeRes().redirectLocal(target));
    }
  });

  it("keeps a 302 Location for legitimate relative targets", () => {
    for (const target of SAFE_TARGETS) {
      const response = makeRes().redirectLocal(target);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(target);
    }
  });

  it("normalizes safe bare relatives exactly like redirect", () => {
    for (const [target, expected] of BARE_TARGETS) {
      const response = makeRes().redirectLocal(target);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("honors a custom redirect status", () => {
    const response = makeRes().redirectLocal("/moved", 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/moved");
  });

  it("is wired through a route handler", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(RedirectLocalController);

    const safe = await app.test(
      new Request(
        `http://localhost/redirect-local?to=${encodeURIComponent("/dashboard")}`,
      ),
    );
    expect(safe.status).toBe(302);
    expect(safe.headers.get("location")).toBe("/dashboard");

    const unsafe = await app.test(
      new Request(
        `http://localhost/redirect-local?to=${encodeURIComponent("https://evil.test")}`,
      ),
    );
    await invalidRedirect(unsafe);
  });
});

describe("res.redirectExternal", () => {
  it("allows absolute http(s) targets and passes them through as-is", () => {
    for (const target of EXTERNAL_TARGETS) {
      const response = makeRes().redirectExternal(target);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(target);
    }
  });

  it("rejects protocol-relative, scheme, backslash, and relative targets", async () => {
    for (const target of EXTERNAL_UNSAFE_TARGETS) {
      await invalidRedirect(makeRes().redirectExternal(target));
    }
  });

  it("does not allow local targets (use redirect instead)", async () => {
    for (const target of ["/", "/dashboard", ...SAFE_TARGETS]) {
      await invalidRedirect(makeRes().redirectExternal(target));
    }
  });

  it("honors a custom redirect status", () => {
    const response = makeRes().redirectExternal("https://auth.test/next", 307);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://auth.test/next");
  });

  it("does not echo a stale Location header on rejection", async () => {
    const builder = makeRes();
    builder.header({ Location: "https://stale.test" });
    await invalidRedirect(builder.redirectExternal("javascript:alert(1)"));
  });

  it("is wired through a route handler", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(RedirectExternalController);

    const target = "https://accounts.example.com/oauth/authorize?client_id=app";
    const safe = await app.test(
      new Request(
        `http://localhost/redirect-external?to=${encodeURIComponent(target)}`,
      ),
    );
    expect(safe.status).toBe(302);
    expect(safe.headers.get("location")).toBe(target);

    const unsafe = await app.test(
      new Request(
        `http://localhost/redirect-external?to=${encodeURIComponent("//evil.test")}`,
      ),
    );
    await invalidRedirect(unsafe);
  });
});
