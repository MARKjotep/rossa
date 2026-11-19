import { describe, expect, it } from "bun:test";
import { Methods, Rossa, route } from "../../src/index";
import type { ctx } from "../../src/http/ctx";

@route("/notes/:id")
class NoteController extends Methods {
  get({ params, res }: ctx): Response {
    return res.json({ id: params.id });
  }

  post({ res }: ctx): Response {
    return res.status(201).json({ created: true });
  }
}

describe("default OPTIONS route behavior", () => {
  it("returns 204 and advertises methods registered for the matched path", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(NoteController);

    const response = await app.test(
      new Request("http://localhost/notes/42", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("GET, POST, OPTIONS");
    expect(await response.text()).toBe("");
  });

  it("keeps OPTIONS scoped to declared paths", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(NoteController);

    const missing = await app.test(
      new Request("http://localhost/unknown", { method: "OPTIONS" }),
    );
    expect(missing.status).toBe(404);
  });
});
