import { describe, expect, it } from "bun:test";
import { cookies } from "../../src/guard/cookie.guard";
import { formDataToObject } from "../../src/guard/shared/form-data.util";
import { json, keys } from "../../src/guard/json.guard";
import { multipart } from "../../src/guard/multipart.guard";
import { validateForm, validateQuery } from "../../src/guard/queries.guard";
import { sanitize } from "../../src/guard/sanitize.guard";
import { urlencoded } from "../../src/guard/urlencoded.guard";
import { z } from "../../src/guard/json/schema.json";
import { jsonRequest, runGuard } from "../helpers";

describe("request parsing and payload validation", () => {
  it("parses and validates JSON, enforces media type and byte limits", async () => {
    const schema = z<{ name: string; count: number }>()
      .string("name")
      .min("name", 1)
      .number("count");
    const guard = json(schema);

    const valid = await runGuard(
      guard,
      jsonRequest("http://localhost/items", { name: "Ada", count: 2 }),
    );
    expect(valid.response.status).toBe(200);
    expect((valid.context.req as any)._json).toEqual({ name: "Ada", count: 2 });

    const wrongMediaType = await runGuard(
      guard,
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/jsonp" },
        body: JSON.stringify({ name: "Ada", count: 2 }),
      }),
    );
    expect(wrongMediaType.response.status).toBe(415);

    const oversized = await runGuard(
      json(schema, { maxSize: 8 }),
      jsonRequest("http://localhost/items", { name: "a long name", count: 2 }),
    );
    expect(oversized.response.status).toBe(413);

    const malformed = await runGuard(
      guard,
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: "{bad json}",
      }),
    );
    expect(malformed.response.status).toBe(400);

    const invalidLength = await runGuard(
      guard,
      new Request("http://localhost/items", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "1e2",
        },
        body: "{}",
      }),
    );
    expect(invalidLength.response.status).toBe(400);
  });

  it("checks own JSON keys and rejects non-object bodies", async () => {
    const missingInheritedKey = await runGuard(
      keys(["constructor"]),
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      }),
    );
    expect(missingInheritedKey.response.status).toBe(400);

    const present = await runGuard(
      keys(["id"]),
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      }),
    );
    expect(present.response.status).toBe(200);
    expect(present.context.body).toEqual({ id: 1 });

    const primitive = await runGuard(
      keys(["id"]),
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
    );
    expect(primitive.response.status).toBe(400);
  });

  it("coerces query values and validates the resulting schema", async () => {
    const schema = z<{ page: number; enabled: boolean }>()
      .number("page", 1)
      .min("page", 1)
      .boolean("enabled", false);
    const guard = validateQuery(schema);

    const valid = await runGuard(
      guard,
      new Request("http://localhost/search?page=4&enabled=true"),
    );
    expect(valid.response.status).toBe(200);
    expect(valid.context.query as any).toEqual({ page: 4, enabled: true });

    const invalid = await runGuard(
      guard,
      new Request("http://localhost/search?page=zero&enabled=true"),
    );
    expect(invalid.response.status).toBe(400);

    const repeatedValues = await runGuard(
      validateQuery(z<{ id: number }>().number("id")),
      new Request("http://localhost/search?id=1&id=2"),
    );
    expect((repeatedValues.context.query as any).id).toBe(2);
  });

  it("validates schema types before rules and uses a literal dot in email rules", async () => {
    const emailSchema = z<{ email: string }>().string("email").email("email");
    const validEmail = await runGuard(
      json(emailSchema),
      jsonRequest("http://localhost/users", { email: "a@example.com" }),
    );
    expect(validEmail.response.status).toBe(200);

    const invalidEmail = await runGuard(
      json(emailSchema),
      jsonRequest("http://localhost/users", { email: "a@exampleXcom" }),
    );
    expect(invalidEmail.response.status).toBe(400);

    const mismatchedType = await runGuard(
      json(z<{ count: number }>().number("count").min("count", 1)),
      jsonRequest("http://localhost/users", { count: true }),
    );
    expect(mismatchedType.response.status).toBe(400);
  });

  it("parses URL-encoded and multipart forms, preserving repeated values", async () => {
    const encoded = await runGuard(
      urlencoded(),
      new Request("http://localhost/form", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "name=Ada&tag=one&tag=two",
      }),
    );
    expect(encoded.response.status).toBe(200);
    expect(encoded.context.form).toEqual({ name: "Ada", tag: ["one", "two"] });

    const multipartBody = new FormData();
    multipartBody.append("name", "Ada");
    multipartBody.append("tag", "one");
    multipartBody.append("tag", "two");
    const multipartResult = await runGuard(
      multipart(),
      new Request("http://localhost/form", {
        method: "POST",
        body: multipartBody,
      }),
    );
    expect(multipartResult.response.status).toBe(200);
    expect(multipartResult.context.form).toEqual({
      name: "Ada",
      tag: ["one", "two"],
    });

    const schema = z<{ page: number }>().number("page");
    const validated = await runGuard(
      validateForm(schema),
      new Request("http://localhost/form", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "page=3",
      }),
    );
    expect(validated.response.status).toBe(200);
    expect(validated.context.form).toEqual({ page: 3 });

    const repeatedForm = new FormData();
    repeatedForm.append("tag", "one");
    repeatedForm.append("tag", "two");
    expect(formDataToObject(repeatedForm).tag).toEqual(["one", "two"]);
  });

  it("sanitizes nested values without losing special property names", async () => {
    const context = (
      await runGuard(sanitize(), new Request("http://localhost/"))
    ).context;
    context.query = {
      q: "<script>alert('x')</script>",
      nested: ["a&b"],
    };
    const input = JSON.parse('{"__proto__":"safe","name":"<Ada>"}');
    (context.req as any)._json = input;

    const response = await sanitize()(context, () => new Response("ok"));
    expect(response.status).toBe(200);
    expect(context.query.q).toBe(
      "&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;",
    );
    expect((context.req as any)._json.name).toBe("&lt;Ada&gt;");
    expect(Object.hasOwn((context.req as any)._json, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf((context.req as any)._json)).toBeNull();
  });

  it("checks for a named cookie without copying cookies to ctx", async () => {
    const result = await runGuard(
      cookies("sid"),
      new Request("http://localhost/", {
        headers: { cookie: "sid=abc; theme=dark" },
      }),
    );
    expect(result.response.status).toBe(200);
    expect(result.context.data.cookies).toBeUndefined();

    const missing = await runGuard(
      cookies("sid"),
      new Request("http://localhost/", {
        headers: { cookie: "theme=dark" },
      }),
    );
    expect(missing.response.status).toBe(401);
    expect(missing.nextCalls).toBe(0);
  });
});
