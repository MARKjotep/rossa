import { describe, expect, it } from "bun:test";
import { Methods, Rossa, route } from "../../src/index";
import type { ctx } from "../../src/http/ctx";

@route("/methods/:id")
class AllMethodsController extends Methods {
  override get({ params, res }: ctx): Response {
    return res.text(`GET ${params.id}`);
  }

  override post({ params, res }: ctx): Response {
    return res.text(`POST ${params.id}`);
  }

  override put({ params, res }: ctx): Response {
    return res.text(`PUT ${params.id}`);
  }

  override head({ params, res }: ctx): Response {
    return res.header({ "X-Method-Result": `HEAD ${params.id}` }).null();
  }

  override delete({ params, res }: ctx): Response {
    return res.text(`DELETE ${params.id}`);
  }

  override patch({ params, res }: ctx): Response {
    return res.text(`PATCH ${params.id}`);
  }

  override event({ params, res }: ctx): Response {
    return res.text(`EVENT ${params.id}`);
  }
}

describe("Methods HTTP handlers", () => {
  it("dispatches each declared HTTP method and extracts route params", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(AllMethodsController);

    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"] as const) {
      const response = await app.test(
        new Request("http://localhost/methods/42", { method }),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`${method} 42`);
    }

    const head = await app.test(
      new Request("http://localhost/methods/42", { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("x-method-result")).toBe("HEAD 42");
    expect(await head.text()).toBe("");

    const event = await app.test(
      new Request("http://localhost/methods/42", {
        headers: { accept: "text/event-stream" },
      }),
    );
    expect(event.status).toBe(200);
    expect(await event.text()).toBe("EVENT 42");
  });

  it("provides the inherited OPTIONS response with declared methods", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(AllMethodsController);

    const response = await app.test(
      new Request("http://localhost/methods/42", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe(
      "GET, POST, PUT, HEAD, DELETE, PATCH, OPTIONS",
    );
    expect(await response.text()).toBe("");
  });
});
