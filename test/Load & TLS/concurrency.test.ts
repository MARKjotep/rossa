import { afterEach, describe, expect, it } from "bun:test";
import type { ctx } from "../../src/http/ctx";
import { Methods, Rossa, route } from "../../src/index";
import { getFreePort } from "../helpers";

@route("/concurrent/:id")
class ConcurrentController extends Methods {
  get({ params, res }: ctx): Response {
    return res.json({ id: params.id });
  }
}

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> =
  [];

afterEach(async () => {
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

describe("concurrent HTTP requests", () => {
  it("serves parallel requests without mixing route parameters or responses", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(ConcurrentController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });
    servers.push(server);

    const ids = Array.from({ length: 64 }, (_, index) => `item-${index}`);
    const responses = await Promise.all(
      ids.map(async (id) => {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/concurrent/${id}`,
        );
        return { status: response.status, body: await response.json() };
      }),
    );

    expect(responses).toHaveLength(ids.length);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responses.map((response) => response.body.id)).toEqual(ids);
  });
});
