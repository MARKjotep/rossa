import { describe, expect, it } from "bun:test";
import { Methods, Rossa, route } from "../../src/index";
import type { ctx } from "../../src/http/ctx";
import { getFreePort } from "../helpers";

@route("/events/:channel")
class EventController extends Methods {
  get({ res }: ctx): Response {
    return res.text("regular get");
  }

  post({ res }: ctx): Response {
    return res.text("regular post");
  }

  event({ params, res }: ctx): Response {
    if (params.channel === "async") {
      return res.event.asyncStream(async function* () {
        yield { source: "async" };
      });
    }
    if (params.channel === "interval") {
      return res.event.eStream(
        () => ({ event: "tick", data: { source: "interval" } }),
        { interval: 1000 },
      );
    }
    return res.event.readableStream((controller) => {
      controller.enqueue('event: manual\ndata: {"source":"readable"}\n\n');
      controller.close();
    });
  }
}

describe("Methods.event routing", () => {
  it("uses asyncStream to send an SSE data event", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(EventController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/events/async`,
        {
          headers: { accept: "text/event-stream" },
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(await response.text()).toBe('data: {"source":"async"}\n\n');
    } finally {
      await server.stop(true);
    }
  });

  it("uses eStream to send named SSE events", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(EventController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/events/interval`,
        {
          headers: { accept: "text/event-stream" },
        },
      );
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(new TextDecoder().decode(first.value)).toContain(
        'event: tick\ndata: {"source":"interval"}',
      );
      await reader.cancel();
    } finally {
      await server.stop(true);
    }
  });

  it("uses readableStream for manually framed SSE", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(EventController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/events/manual`,
        {
          headers: { accept: "text/event-stream" },
        },
      );
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(await response.text()).toBe(
        'event: manual\ndata: {"source":"readable"}\n\n',
      );
    } finally {
      await server.stop(true);
    }
  });

  it("uses the regular GET handler without the event-stream accept header", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(EventController);

    const response = await app.test(
      new Request("http://localhost/events/updates"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("regular get");
  });

  it("does not route rejected event media types or non-GET methods to event", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(EventController);

    const rejected = await app.test(
      new Request("http://localhost/events/updates", {
        headers: { accept: "application/json, TEXT/EVENT-STREAM; q=0" },
      }),
    );
    expect(await rejected.text()).toBe("regular get");

    const post = await app.test(
      new Request("http://localhost/events/updates", {
        method: "POST",
        headers: { accept: "text/event-stream" },
      }),
    );
    expect(await post.text()).toBe("regular post");
  });
});
