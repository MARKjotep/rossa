import { describe, expect, it } from "bun:test";
import { Methods, Rossa, route, security } from "../../src/index";
import type { ctx } from "../../src/http/ctx";
import { createGuard } from "../../src/guard/@/base.guard";

@route("/health")
class HealthController extends Methods {
  get({ res }: ctx): Response {
    return res.json({ status: "ok" });
  }
}

@route("/items/:id")
class ItemController extends Methods {
  get({ params, res }: ctx): Response {
    return res.json({ id: params.id });
  }
}

@route("/context/:id")
class ContextController extends Methods {
  get({ method, methods, params, req, res }: ctx): Response {
    return res.json({
      method,
      methods,
      id: params.id,
      search: req.query.search,
    });
  }
}

@route("/fails")
class FailingController extends Methods {
  get(): Response {
    throw new Error("handler failure");
  }
}

describe("Rossa HTTP smoke tests", () => {
  it("registers routes, extracts params, applies global guards, and returns 404s", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(security());
    app.register(HealthController, ItemController);

    const health = await app.test(
      new Request("http://localhost/health", { method: "GET" }),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");

    const item = await app.test(
      new Request("http://localhost/items/item-42", { method: "GET" }),
    );
    expect(item.status).toBe(200);
    expect(await item.json()).toEqual({ id: "item-42" });

    const missing = await app.test(
      new Request("http://localhost/missing", { method: "GET" }),
    );
    expect(missing.status).toBe(404);
  });

  it("applies a base path and builds request context from the matched route", async () => {
    const app = new Rossa({ basePath: "/api/", Encoding: "none" });
    app.register(ContextController);

    const response = await app.test(
      new Request("http://localhost/api/context/user-7?search=blue"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "GET",
      methods: ["GET", "OPTIONS"],
      id: "user-7",
      search: "blue",
    });

    const withoutBasePath = await app.test(
      new Request("http://localhost/context/user-7?search=blue"),
    );
    expect(withoutBasePath.status).toBe(404);
  });

  it("stops at a rejecting global guard without invoking the route", async () => {
    let routeCalled = false;
    const app = new Rossa({ Encoding: "none" });
    app.use(
      createGuard<void>(async () => new Response("blocked", { status: 403 }))(),
    );
    app.register(
      class GuardedController extends Methods {
        get({ res }: ctx) {
          routeCalled = true;
          return res.text("reached route");
        }
      },
    );

    const response = await app.test(new Request("http://localhost/"));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("blocked");
    expect(routeCalled).toBe(false);
  });

  it("converts an uncaught handler error to a 500 response", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(FailingController);

    const response = await app.test(
      new Request("http://localhost/fails"),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });
});
