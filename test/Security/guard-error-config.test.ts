import { describe, expect, it } from "bun:test";
import { createGuard } from "../../src/guard/@/base.guard";
import { cors } from "../../src/guard/cors.guard";
import { sendError } from "../../src/http/res";
import { makeContext, runGuard } from "../helpers";

const request = (origin?: string) =>
  new Request("http://localhost/guard/cors", {
    headers: origin ? { origin } : {},
  });

describe("guard error configuration", () => {
  it("lets a per-call code win over the factory default", async () => {
    const guard = createGuard(
      async (_ctx, _next, _options, config) => sendError(config),
      {
        id: "repro",
        code: 418,
        message: "Default",
      },
    );

    const overridden = await runGuard(
      guard(undefined, { code: 451, message: "Override" }),
      request(),
    );
    expect(overridden.response.status).toBe(451);
    expect(await overridden.response.json()).toEqual({
      success: false,
      error: "Override",
    });
    expect(overridden.nextCalls).toBe(0);

    const defaulted = await runGuard(guard(), request());
    expect(defaulted.response.status).toBe(418);
    expect(await defaulted.response.json()).toEqual({
      success: false,
      error: "Default",
    });
  });

  it("falls back to 400 when no code is configured anywhere", async () => {
    const guard = createGuard(async (_ctx, _next, _options, config) =>
      sendError(config),
    );

    const response = await runGuard(guard(), request());
    expect(response.response.status).toBe(400);
  });

  it("keeps merging message and headers as before", async () => {
    const guard = createGuard(
      async (_ctx, _next, _options, config) => sendError(config),
      {
        code: 400,
        message: "Base",
        headers: { "x-default": "1", "x-both": "default" },
      },
    );

    const merged = await runGuard(
      guard(undefined, {
        message: "Overridden",
        headers: { "x-both": "override", "x-extra": "2" },
      }),
      request(),
    );
    expect(merged.response.status).toBe(400);
    expect(merged.response.headers.get("x-default")).toBe("1");
    expect(merged.response.headers.get("x-both")).toBe("override");
    expect(merged.response.headers.get("x-extra")).toBe("2");
    expect(await merged.response.json()).toEqual({
      success: false,
      error: "Overridden",
    });
  });

  it("does not add CORS headers to error responses by default", async () => {
    const response = sendError({ code: 403, message: "Forbidden" });
    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(await response.json()).toEqual({
      success: false,
      error: "Forbidden",
    });

    const explicit = sendError({
      code: 403,
      headers: { "Access-Control-Allow-Origin": "https://client.example" },
    });
    expect(explicit.status).toBe(403);
    expect(explicit.headers.get("access-control-allow-origin")).toBe(
      "https://client.example",
    );
    expect(await explicit.json()).toEqual({
      success: false,
      error: "Forbidden",
    });
  });

  it("answers CORS rejections without a wildcard grant", async () => {
    const guard = cors({ origin: ["http://allowed.test"] });

    const denied = await runGuard(guard, request("http://evil.test"));
    expect(denied.response.status).toBe(403);
    expect(denied.response.headers.has("access-control-allow-origin")).toBe(
      false,
    );
    expect(await denied.response.json()).toEqual({
      success: false,
      error: "CORS Origin Not Allowed",
    });

    const allowedContext = makeContext(request("http://allowed.test"));
    const allowed = await guard(allowedContext, () =>
      allowedContext.res.text("ok"),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://allowed.test",
    );
  });
});
