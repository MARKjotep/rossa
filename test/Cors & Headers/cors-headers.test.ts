import { describe, expect, it } from "bun:test";
import { contentType } from "../../src/guard/content.guard";
import { cors } from "../../src/guard/cors.guard";
import { header } from "../../src/guard/header.guard";
import { security } from "../../src/guard/security.guard";
import { makeContext, runGuard } from "../helpers";

describe("CORS, content type, header, and security header guards", () => {
  it("matches normalized media types and rejects lookalike values", async () => {
    const guard = contentType(["application/json", "text/plain"]);
    const accepted = await runGuard(
      guard,
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": " Application/JSON ; charset=utf-8 " },
        body: "{}",
      }),
    );
    expect(accepted.response.status).toBe(200);

    const rejected = await runGuard(
      guard,
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/jsonp" },
        body: "{}",
      }),
    );
    expect(rejected.response.status).toBe(415);
  });

  it("requires header names and runs custom header validators", async () => {
    const required = header(["x-request-id"]);
    const missing = await runGuard(required, new Request("http://localhost/"));
    expect(missing.response.status).toBe(401);

    const present = await runGuard(
      required,
      new Request("http://localhost/", {
        headers: { "x-request-id": "req-1" },
      }),
    );
    expect(present.response.status).toBe(200);

    const validated = await runGuard(
      header({ "x-tenant": (_ctx, name, value) => name === "x-tenant" && value === "a" }),
      new Request("http://localhost/", { headers: { "x-tenant": "a" } }),
    );
    expect(validated.response.status).toBe(200);
  });

  it("allows only configured origins and emits credential-safe preflight headers", async () => {
    const allowedOrigin = "https://client.example";
    const guard = cors({
      origin: [allowedOrigin],
      credentials: true,
      methods: ["GET", "POST"],
      allowHeaders: ["content-type", "x-csrf-token"],
      exposeHeaders: "x-request-id",
    });

    const allowedContext = makeContext(
      new Request("http://localhost/", {
        method: "OPTIONS",
        headers: { origin: allowedOrigin },
      }),
    );
    allowedContext.res.header({ Vary: "Accept-Encoding" });
    const allowedResponse = await guard(allowedContext, () =>
      allowedContext.res.text("preflight"),
    );
    const headers = allowedResponse.headers;
    expect(headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(headers.get("access-control-allow-credentials")).toBe("true");
    expect(headers.get("access-control-allow-methods")).toBe("GET, POST");
    expect(headers.get("access-control-allow-headers")).toBe("content-type, x-csrf-token");
    expect(headers.get("access-control-expose-headers")).toBe("x-request-id");
    expect(headers.get("vary")).toBe("Accept-Encoding, Origin");

    const denied = await runGuard(
      guard,
      new Request("http://localhost/", {
        headers: { origin: "https://attacker.example" },
      }),
    );
    expect(denied.response.status).toBe(403);

    const wildcardContext = makeContext(
      new Request("http://localhost/", { headers: { origin: allowedOrigin } }),
    );
    const wildcardCredentials = await cors({ credentials: true })(
      wildcardContext,
      () => wildcardContext.res.text("wildcard"),
    );
    expect(wildcardCredentials.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
  });

  it("adds secure defaults and permits explicit opt-outs", async () => {
    const response = await runGuard(
      security({ contentSecurityPolicy: "default-src 'self'", hsts: "max-age=31536000" }),
      new Request("http://localhost/"),
    );
    expect(response.response.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(response.response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(response.response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");

    const optedOut = await runGuard(
      security({ xFrameOptions: false }),
      new Request("http://localhost/"),
    );
    expect(optedOut.response.headers.has("x-frame-options")).toBe(false);
  });
});
