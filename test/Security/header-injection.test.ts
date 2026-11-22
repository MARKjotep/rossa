import { describe, expect, it } from "bun:test";
import {
  Methods,
  Rossa,
  type ctx,
  errorHandler,
  route,
  use,
} from "../../src/index";
import { getFreePort } from "../helpers";

/** The exact B2 repro query: an echoed value carrying a CRLF header split. */
const INJECTION_QUERY = "?v=a%0d%0aX-Injected:%201";

@route("/echo")
@use(errorHandler())
class MethodEchoController extends Methods {
  get({ req, res }: ctx) {
    res.header({ "X-Echo": String(req.query.v) });
    return res.json({ ok: true });
  }
}

@route("/echo-global")
class GlobalEchoController extends Methods {
  get({ req, res }: ctx) {
    res.header({ "X-Echo": String(req.query.v) });
    return res.json({ ok: true });
  }
}

type Builders = { _headers: Record<string, string> };

@route("/poisoned")
class PoisonedController extends Methods {
  get({ res }: ctx): Response {
    // Simulate a header written through a path that bypasses `res.header()`;
    // the assembler must drop/sanitize it instead of failing the response.
    const headers = (res as unknown as Builders)._headers;
    headers["X-Echo"] = "safe\r\nX-Injected: 1\0";
    headers["X\r\nInjected"] = "1";
    throw new Error("handler failure");
  }
}

const serve = async (app: Rossa) => {
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  return { server, base: `http://127.0.0.1:${server.port}` };
};

describe("header injection", () => {
  it("answers the method-level errorHandler repro without an injected header", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(MethodEchoController);
    const { server, base } = await serve(app);

    try {
      const response = await fetch(`${base}/echo${INJECTION_QUERY}`);
      expect(response.status).toBeLessThan(500);
      expect(response.headers.has("x-injected")).toBe(false);
      expect(response.headers.get("x-echo")).toBe("aX-Injected: 1");
      expect(await response.json()).toEqual({ ok: true });

      // Same connection, clean follow-up request.
      const followUp = await fetch(`${base}/echo?v=hello`);
      expect(followUp.status).toBe(200);
      expect(followUp.headers.get("x-echo")).toBe("hello");
    } finally {
      await server.stop(true);
    }
  });

  it("answers the global errorHandler repro without an injected header", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(errorHandler());
    app.register(GlobalEchoController);
    const { server, base } = await serve(app);

    try {
      const response = await fetch(`${base}/echo-global${INJECTION_QUERY}`);
      expect(response.status).toBeLessThan(500);
      expect(response.headers.has("x-injected")).toBe(false);
      expect(await response.json()).toEqual({ ok: true });

      const followUp = await fetch(`${base}/echo-global?v=world`);
      expect(followUp.status).toBe(200);
      expect(followUp.headers.get("x-echo")).toBe("world");
    } finally {
      await server.stop(true);
    }
  });

  it("falls back to a safe 500 when a poisoned builder still throws", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(errorHandler());
    app.register(PoisonedController);
    const { server, base } = await serve(app);

    try {
      const response = await fetch(`${base}/poisoned`);
      expect(response.status).toBe(500);
      expect(response.headers.has("x-injected")).toBe(false);
      expect(await response.text()).toBe("Internal Server Error");

      const followUp = await fetch(`${base}/poisoned`);
      expect(followUp.status).toBe(500);
    } finally {
      await server.stop(true);
    }
  });
});

describe("header value sanitizing", () => {
  it("strips CR, LF, and NUL on write and keeps the response usable", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(GlobalEchoController);

    const response = await app.test(
      new Request(
        `http://localhost/echo-global?v=${encodeURIComponent(
          "value\r\nX-Injected: 1\0",
        )}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("x-injected")).toBe(false);
    expect(response.headers.get("x-echo")).toBe("valueX-Injected: 1");
  });
});
