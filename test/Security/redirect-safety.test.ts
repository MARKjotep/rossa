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
];

const SAFE_TARGETS = [
  "/",
  "/dashboard",
  "/users/42?tab=settings",
  "/login?next=%2Fdashboard",
  "/files/100%25",
  "/docs#install",
];

@route("/redirect-local")
class RedirectLocalController extends Methods {
  get({ req, res }: ctx) {
    return res.redirectLocal(String(req.query.to ?? ""));
  }
}

const makeRes = () => makeContext(new Request("http://localhost/go")).res;

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

  it("rejects non-strings without throwing", () => {
    expect(isLocalRedirectTarget(undefined as unknown as string)).toBe(false);
    expect(isLocalRedirectTarget(null as unknown as string)).toBe(false);
  });
});

describe("res.redirectLocal", () => {
  it("answers 400 with the documented body and no Location for unsafe targets", async () => {
    for (const target of UNSAFE_TARGETS) {
      const response = makeRes().redirectLocal(target);
      expect(response.status).toBe(400);
      expect(response.headers.has("location")).toBe(false);
      expect(await response.json()).toEqual({
        success: false,
        error: "Invalid redirect target",
      });
    }
  });

  it("keeps a 302 Location for legitimate relative targets", () => {
    for (const target of SAFE_TARGETS) {
      const response = makeRes().redirectLocal(target);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(target);
    }
  });

  it("honors a custom redirect status", () => {
    const response = makeRes().redirectLocal("/moved", 301);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/moved");
  });

  it("does not echo a stale Location header on rejection", () => {
    const builder = makeRes();
    builder.header({ Location: "/stale" });
    const response = builder.redirectLocal("//evil.test");
    expect(response.status).toBe(400);
    expect(response.headers.has("location")).toBe(false);
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
    expect(unsafe.status).toBe(400);
    expect(unsafe.headers.has("location")).toBe(false);
    expect(await unsafe.json()).toEqual({
      success: false,
      error: "Invalid redirect target",
    });
  });
});

describe("res.redirect", () => {
  it("still allows documented absolute targets", () => {
    const response = makeRes().redirect("https://external.test/next");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://external.test/next",
    );
  });

  it("strips CR/LF from the target so it cannot inject headers", () => {
    const response = makeRes().redirect(
      "/next\r\nSet-Cookie: injected=1\r\nX-Injected: 1",
    );
    expect(response.status).toBe(302);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-injected")).toBe(false);
    expect(response.headers.get("location")).not.toMatch(/[\r\n]/);
  });
});
