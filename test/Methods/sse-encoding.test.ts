import { describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import { Methods, Req, Res, Rossa, type ctx, route } from "../../src/index";
import { StaticFileServer } from "../../src/core/static-server";
import { getFreePort } from "../helpers";

const COMPRESSED_ACCEPT = "gzip, deflate, br";

@route("/sse/async")
class AsyncSseController extends Methods {
  get({ res }: ctx) {
    return res.text("async");
  }

  event({ res }: ctx) {
    return res.event.asyncStream(async function* () {
      yield { source: "async" };
    });
  }
}

@route("/sse/interval")
class IntervalSseController extends Methods {
  get({ res }: ctx) {
    return res.text("interval");
  }

  event({ res }: ctx) {
    return res.event.eStream(
      () => ({ event: "tick", data: { source: "interval" } }),
      { interval: 1000 },
    );
  }
}

@route("/sse/manual")
class ManualSseController extends Methods {
  get({ res }: ctx) {
    return res.text("manual");
  }

  event({ res }: ctx) {
    return res.event.readableStream((controller) => {
      controller.enqueue('event: manual\ndata: {"source":"readable"}\n\n');
      controller.close();
    });
  }
}

const serve = async (app: Rossa) => {
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  return { server, base: `http://127.0.0.1:${server.port}` };
};

describe("SSE content encoding", () => {
  it("omits Content-Encoding for asyncStream when compression is accepted", async () => {
    const app = new Rossa(); // negotiates br by default
    app.register(AsyncSseController);
    const { server, base } = await serve(app);

    try {
      const response = await fetch(`${base}/sse/async`, {
        headers: {
          accept: "text/event-stream",
          "accept-encoding": COMPRESSED_ACCEPT,
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(response.headers.has("content-encoding")).toBe(false);
      expect(await response.text()).toBe('data: {"source":"async"}\n\n');
    } finally {
      await server.stop(true);
    }
  });

  it("omits Content-Encoding for readableStream when compression is accepted", async () => {
    const app = new Rossa();
    app.register(ManualSseController);
    const { server, base } = await serve(app);

    try {
      const response = await fetch(`${base}/sse/manual`, {
        headers: {
          accept: "text/event-stream",
          "accept-encoding": COMPRESSED_ACCEPT,
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.has("content-encoding")).toBe(false);
      expect(await response.text()).toBe(
        'event: manual\ndata: {"source":"readable"}\n\n',
      );
    } finally {
      await server.stop(true);
    }
  });

  it("omits Content-Encoding for eStream when compression is accepted", async () => {
    const app = new Rossa();
    app.register(IntervalSseController);
    const { server, base } = await serve(app);

    try {
      const response = await fetch(`${base}/sse/interval`, {
        headers: {
          accept: "text/event-stream",
          "accept-encoding": COMPRESSED_ACCEPT,
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.has("content-encoding")).toBe(false);
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain(
        'event: tick\ndata: {"source":"interval"}',
      );
      await reader.cancel();
    } finally {
      await server.stop(true);
    }
  });

  it("keeps normal JSON compression intact", async () => {
    const request = new Request("http://localhost/compressed", {
      headers: { "accept-encoding": "gzip" },
    });
    const builder = new Res(
      { encoding: "gzip" },
      new Req(request),
      new StaticFileServer(process.cwd()),
    );

    const response = builder.json({ ok: true });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const decoded = gunzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(decoded))).toEqual({ ok: true });
  });
});
