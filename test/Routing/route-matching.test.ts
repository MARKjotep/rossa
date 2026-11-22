import { describe, expect, it } from "bun:test";
import { Methods, Rossa, route } from "../../src/index";
import type { ctx } from "../../src/http/ctx";

@route("/a.b")
class DottedController extends Methods {
  get({ res }: ctx): Response {
    return res.text("dotted");
  }
}

@route("/v1.0/items/:id")
class VersionedItemController extends Methods {
  get({ params, res }: ctx): Response {
    return res.json({ id: params.id });
  }
}

@route("/c++/guide")
class LiteralSymbolsController extends Methods {
  get({ res }: ctx): Response {
    return res.text("literal");
  }
}

describe("route path compilation", () => {
  it("treats dots as literal characters", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(DottedController);

    const exact = await app.test(new Request("http://localhost/a.b"));
    expect(exact.status).toBe(200);
    expect(await exact.text()).toBe("dotted");

    const wildcardLike = await app.test(new Request("http://localhost/axb"));
    expect(wildcardLike.status).toBe(404);
  });

  it("keeps named parameters and optional trailing slashes working", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(VersionedItemController);

    const match = await app.test(
      new Request("http://localhost/v1.0/items/item-7/"),
    );
    expect(match.status).toBe(200);
    expect(await match.json()).toEqual({ id: "item-7" });

    const wrongLiteral = await app.test(
      new Request("http://localhost/v1X0/items/item-7"),
    );
    expect(wrongLiteral.status).toBe(404);
  });

  it("escapes other regular-expression metacharacters", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(LiteralSymbolsController);

    const exact = await app.test(new Request("http://localhost/c++/guide"));
    expect(exact.status).toBe(200);
    expect(await exact.text()).toBe("literal");

    const repeated = await app.test(new Request("http://localhost/cc/guide"));
    expect(repeated.status).toBe(404);
  });
});
