import { describe, expect, it } from "bun:test";
import { json, keys } from "../../src/guard/json.guard";
import { sanitize } from "../../src/guard/sanitize.guard";
import { urlencoded } from "../../src/guard/urlencoded.guard";
import { z } from "../../src/schema";
import { jsonRequest, makeContext, runGuard } from "../helpers";

const formRequest = (body: string) =>
  new Request("http://localhost/form", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

describe("urlencoded strict parsing", () => {
  it("rejects malformed percent-encoding and NUL bytes in strict mode", async () => {
    const guard = urlencoded({ strict: true });

    for (const body of ["bad=%ZZ&x=1", "bare=%&x=1", "nul=%00abc", `raw=\u0000`]) {
      const result = await runGuard(guard, formRequest(body));
      expect(result.response.status).toBe(400);
      expect(result.nextCalls).toBe(0);
      expect(await result.response.json()).toEqual({
        success: false,
        error: "Invalid URL-encoded form data",
      });
    }
  });

  it("exposes a configurable message and status for strict failures", async () => {
    const result = await runGuard(
      urlencoded({ strict: true }, { code: 422, message: "Corrupt form" }),
      formRequest("bad=%ZZ"),
    );
    expect(result.response.status).toBe(422);
    expect(await result.response.json()).toEqual({
      success: false,
      error: "Corrupt form",
    });
  });

  it("keeps accepting valid and repeated fields in strict mode", async () => {
    const result = await runGuard(
      urlencoded({ strict: true }),
      formRequest("name=Ada&tag=one&tag=two&q=a+b&plus=%2B"),
    );
    expect(result.response.status).toBe(200);
    expect(result.context.form).toEqual({
      name: "Ada",
      tag: ["one", "two"],
      q: "a b",
      plus: "+",
    });
  });

  it("keeps lenient parsing unchanged by default", async () => {
    const guard = urlencoded();

    const malformed = await runGuard(guard, formRequest("bad=%ZZ&bare=%"));
    expect(malformed.response.status).toBe(200);
    expect(malformed.context.form).toEqual({ bad: "%ZZ", bare: "%" });

    const nul = await runGuard(guard, formRequest("nul=%00abc"));
    expect(nul.response.status).toBe(200);
    expect(nul.context.form).toEqual({ nul: "\u0000abc" });
  });

  it("skips non-urlencoded payloads even in strict mode", async () => {
    const result = await runGuard(
      urlencoded({ strict: true }),
      jsonRequest("http://localhost/json", { name: "Ada" }),
    );
    expect(result.response.status).toBe(200);
    expect(result.nextCalls).toBe(1);
  });
});

describe("parsed body placement", () => {
  it("stores the validated JSON body in ctx.body and keeps ctx.req._json", async () => {
    const request = jsonRequest("http://localhost/items", { name: "Ada" });
    const context = makeContext(request);

    const response = await json(z.object({ name: z.string() }))(
      context,
      () => new Response("ok"),
    );

    expect(response.status).toBe(200);
    expect(context.body).toEqual({ name: "Ada" });
    expect((context.req as any)._json).toEqual({ name: "Ada" });
    expect(context.body).toBe((context.req as any)._json);
  });

  it("matches the field populated by keys([...])", async () => {
    const request = jsonRequest("http://localhost/items", { id: 1 });
    const context = makeContext(request);

    await keys(["id"])(context, () => new Response("ok"));
    expect(context.body).toEqual({ id: 1 });
  });

  it("sanitizes the unified body once so both views stay identical", async () => {
    const request = jsonRequest("http://localhost/items", {
      name: "<script>alert('x')</script>",
      nested: { tag: "a&b" },
    });
    const context = makeContext(request);

    await json(
      z.object({ name: z.string(), nested: z.object({ tag: z.string() }) }),
    )(context, () => new Response("ok"));
    expect((context.req as any)._json).toBe(context.body);

    const response = await sanitize()(context, () => new Response("ok"));
    expect(response.status).toBe(200);
    expect((context.body as any).name).toBe(
      "&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;",
    );
    expect((context.body as any).nested.tag).toBe("a&amp;b");
    expect((context.req as any)._json).toBe(context.body);
    expect((context.req as any)._json.nested.tag).toBe("a&amp;b");
  });
});
