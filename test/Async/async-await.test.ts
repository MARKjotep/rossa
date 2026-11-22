import { describe, expect, it } from "bun:test";
import type { ctx } from "../../src/http/ctx";
import { Methods, Rossa, route, use } from "../../src/index";
import { createGuard } from "../../src/guard/@/base.guard";
import { errorHandler } from "../../src/guard/error.guard";
import { getFreePort, makeContext, runGuard } from "../helpers";

/**
 * These tests prove that Rossa awaits each async stage of the pipeline — guards,
 * route handlers, and the final response — before the HTTP response is sent.
 * Real timers are used so a missing `await` shows up as a response arriving too
 * early (or as a corrupted response), not just as a thrown error.
 */

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Fetches with a hard timeout so a hung server fails the test instead of the suite. */
async function fetchWithTimeout(
  input: string,
  timeoutMs = 2_000,
): Promise<Response> {
  return await Promise.race([
    fetch(input),
    delay(timeoutMs).then(() => {
      throw new Error(
        `Request to ${input} did not settle within ${timeoutMs}ms`,
      );
    }),
  ]);
}

// --- Scenario 1: async guard delay + downstream state ------------------------

const markerGuard = createGuard<void>(async (ctx, next) => {
  await delay(60);
  ctx.data.marker = "set-after-await";
  return await next();
})();

@route("/async/marker")
@use(markerGuard)
class MarkerController extends Methods {
  get({ data, res }: ctx): Response {
    return res.json({ marker: data.marker });
  }
}

// --- Scenario 2: async route handler with sequential awaits -----------------

@route("/async/steps")
class StepsController extends Methods {
  async get({ res }: ctx): Promise<Response> {
    await delay(60);
    const first = "step-one";
    await delay(40);
    return res.json({ value: `${first}+step-two` });
  }
}

// --- Scenario 3: async short-circuit guard ----------------------------------

const shortCircuitGuard = createGuard<void>(async (ctx) => {
  await delay(50);
  return ctx.res.status(403).json({ blocked: true });
})();

let shortCircuitDownstreamCalls = 0;

@route("/async/blocked")
@use(shortCircuitGuard)
class BlockedController extends Methods {
  get({ res }: ctx): Response {
    shortCircuitDownstreamCalls += 1;
    return res.text("downstream ran");
  }
}

// --- Scenario 4: async guard chain ordering ---------------------------------

const guardOrder: string[] = [];

const orderGlobalGuard = createGuard<void>(async (_ctx, next) => {
  await delay(30);
  guardOrder.push("global");
  return await next();
})();

const orderClassGuard = createGuard<void>(async (_ctx, next) => {
  await delay(20);
  guardOrder.push("class");
  return await next();
})();

const orderMethodGuard = createGuard<void>(async (_ctx, next) => {
  await delay(10);
  guardOrder.push("method");
  return await next();
})();

@route("/async/order")
@use(orderClassGuard)
class OrderedController extends Methods {
  @use(orderMethodGuard)
  get({ res }: ctx): Response {
    guardOrder.push("handler");
    return res.json({ order: [...guardOrder] });
  }
}

// --- Scenario 5: async handler that throws ----------------------------------

@route("/async/handler-throws")
class ThrowingHandlerController extends Methods {
  async get(): Promise<Response> {
    await delay(50);
    throw new Error("async handler boom");
  }
}

// --- Scenario 6: async guard that throws after awaiting ---------------------

const throwingGuard = createGuard<void>(async () => {
  await delay(40);
  throw new Error("async guard boom");
})();

@route("/async/guard-throws")
@use(throwingGuard)
class ThrowingGuardController extends Methods {
  get({ res }: ctx): Response {
    return res.text("unreachable");
  }
}

// --- Scenario 7: concurrent requests with different delays ------------------

@route("/async/concurrent/:pace")
class ConcurrentPaceController extends Methods {
  async get({ params, res }: ctx): Promise<Response> {
    const waitFor = params.pace === "slow" ? 120 : 20;
    const started = performance.now();
    await delay(waitFor);
    return res.json({
      pace: params.pace,
      waited: Math.round(performance.now() - started),
    });
  }
}

describe("async guards at the guard level", () => {
  it("awaits an async guard before next() and passes post-await state downstream", async () => {
    const request = new Request("http://localhost/async/marker");

    const started = performance.now();
    const result = await runGuard(markerGuard, request);
    const elapsed = performance.now() - started;

    // The guard did not resolve before its delay elapsed.
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(result.nextCalls).toBe(1);
    expect(result.response.status).toBe(200);
    expect(result.context.data.marker).toBe("set-after-await");

    // Direct invocation: downstream must observe the value written after the await.
    const context = makeContext(request);
    let observedDownstream: unknown;
    const response = await markerGuard(context, () => {
      observedDownstream = context.data.marker;
      return new Response("downstream", { status: 200 });
    });

    expect(observedDownstream).toBe("set-after-await");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("downstream");
  });

  it("returns an async short-circuit without calling next() or running downstream", async () => {
    const request = new Request("http://localhost/async/blocked");
    const context = makeContext(request);

    let downstreamCalls = 0;
    const started = performance.now();
    const response = await shortCircuitGuard(context, () => {
      downstreamCalls += 1;
      return new Response("downstream", { status: 200 });
    });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ blocked: true });
    expect(downstreamCalls).toBe(0);
  });

  it("rejects when an async guard throws after awaiting", async () => {
    const started = performance.now();
    await expect(
      runGuard(throwingGuard, new Request("http://localhost/async/guard-throws")),
    ).rejects.toThrow("async guard boom");
    expect(performance.now() - started).toBeGreaterThanOrEqual(30);
  });

  it("awaits a returned next() promise just like await next()", async () => {
    // An async guard that *returns* next() (without await) still returns a
    // promise that adopts the downstream result. The core pipeline awaits the
    // guard's return value, so both forms are fully honored. Only a truly
    // detached call (`next(); return otherResponse;`) would run downstream in
    // the background; that is user code racing the framework, not a pipeline bug.
    const awaitedNext = createGuard<void>(async (_ctx, next) => {
      await delay(20);
      return await next();
    })();
    const returnedNext = createGuard<void>(async (_ctx, next) => {
      await delay(20);
      return next();
    })();

    const downstream = async () => {
      await delay(30);
      return new Response("deep-value", { status: 201 });
    };

    const awaitedStart = performance.now();
    const awaited = await awaitedNext(
      makeContext(new Request("http://localhost/async/next-awaited")),
      downstream,
    );
    const awaitedElapsed = performance.now() - awaitedStart;

    const returnedStart = performance.now();
    const returned = await returnedNext(
      makeContext(new Request("http://localhost/async/next-returned")),
      downstream,
    );
    const returnedElapsed = performance.now() - returnedStart;

    expect(awaited.status).toBe(201);
    expect(returned.status).toBe(201);
    expect(awaited.status).toBe(returned.status);
    expect(await awaited.text()).toBe("deep-value");
    expect(await returned.text()).toBe("deep-value");
    // Each call waited for both the guard delay (20ms) and the downstream delay (30ms).
    expect(awaitedElapsed).toBeGreaterThanOrEqual(40);
    expect(returnedElapsed).toBeGreaterThanOrEqual(40);
  });
});

describe("async guards and handlers against a live server", () => {
  it("waits for an async guard delay and lets the route see guard state", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(MarkerController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const started = performance.now();
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/marker`,
      );
      const elapsed = performance.now() - started;

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ marker: "set-after-await" });
      expect(elapsed).toBeGreaterThanOrEqual(45);
    } finally {
      await server.stop(true);
    }
  });

  it("awaits sequential async steps in a route handler before responding", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(StepsController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const started = performance.now();
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/steps`,
      );
      const elapsed = performance.now() - started;

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ value: "step-one+step-two" });
      // 60ms + 40ms, minus scheduling slack: the response cannot have been sent early.
      expect(elapsed).toBeGreaterThanOrEqual(85);
    } finally {
      await server.stop(true);
    }
  });

  it("returns the async guard short-circuit and never runs the route handler", async () => {
    shortCircuitDownstreamCalls = 0;
    const app = new Rossa({ Encoding: "none" });
    app.register(BlockedController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const started = performance.now();
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/blocked`,
      );
      const elapsed = performance.now() - started;

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ blocked: true });
      expect(shortCircuitDownstreamCalls).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(35);
    } finally {
      await server.stop(true);
    }
  });

  it("runs three async guards in order before the handler", async () => {
    guardOrder.length = 0;
    const app = new Rossa({ Encoding: "none" });
    app.use(orderGlobalGuard);
    app.register(OrderedController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const started = performance.now();
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/order`,
      );
      const elapsed = performance.now() - started;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ order: ["global", "class", "method", "handler"] });
      // 30 + 20 + 10ms of guard delays are serialized before the handler runs.
      expect(elapsed).toBeGreaterThanOrEqual(50);
      // The shared log is only populated sequentially because every stage awaited.
      expect(guardOrder).toEqual(["global", "class", "method", "handler"]);
    } finally {
      await server.stop(true);
    }
  });

  it("turns an async handler throw into a 5xx without hanging or leaking a rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const app = new Rossa({ Encoding: "none" });
    app.register(ThrowingHandlerController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const started = performance.now();
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/handler-throws`,
      );
      const elapsed = performance.now() - started;

      // Core pipeline catch: 500 with an empty body.
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("");
      // It waited for the handler's await before failing.
      expect(elapsed).toBeGreaterThanOrEqual(40);
      // Give any orphaned promise a chance to surface.
      await delay(25);
      expect(unhandled).toEqual([]);

      // With the error guard installed the framework still returns a 5xx.
      const guarded = new Rossa({ Encoding: "none" });
      guarded.use(errorHandler());
      guarded.register(ThrowingHandlerController);
      const guardedServer = guarded.serve({
        hostname: "127.0.0.1",
        port: await getFreePort(),
      });
      try {
        const guardedResponse = await fetchWithTimeout(
          `http://127.0.0.1:${guardedServer.port}/async/handler-throws`,
        );
        expect(guardedResponse.status).toBe(500);
        expect(await guardedResponse.text()).toBe("Internal Server Error");
      } finally {
        await guardedServer.stop(true);
      }
    } finally {
      await server.stop(true);
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("turns an async guard throw into a 5xx without hanging or leaking a rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    // Error guard is registered after the throwing guard so that the unshift
    // behavior places it first in the chain and it can catch the downstream throw.
    const app = new Rossa({ Encoding: "none" });
    app.use(throwingGuard);
    app.use(errorHandler());
    app.register(ThrowingGuardController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const started = performance.now();
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/guard-throws`,
      );
      const elapsed = performance.now() - started;

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Internal Server Error");
      expect(elapsed).toBeGreaterThanOrEqual(30);

      await delay(25);
      expect(unhandled).toEqual([]);

      // Without an error guard the core pipeline catch still answers 500.
      const bare = new Rossa({ Encoding: "none" });
      bare.use(throwingGuard);
      bare.register(ThrowingGuardController);
      const bareServer = bare.serve({
        hostname: "127.0.0.1",
        port: await getFreePort(),
      });
      try {
        const bareResponse = await fetchWithTimeout(
          `http://127.0.0.1:${bareServer.port}/async/guard-throws`,
        );
        expect(bareResponse.status).toBe(500);
        expect(await bareResponse.text()).toBe("");
      } finally {
        await bareServer.stop(true);
      }
    } finally {
      await server.stop(true);
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("keeps concurrent fast and slow requests independent", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(ConcurrentPaceController);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const fastStart = performance.now();
      const fastPromise = fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/concurrent/fast`,
      ).then(async (response) => ({
        elapsed: performance.now() - fastStart,
        status: response.status,
        body: await response.json(),
      }));

      // Start the slow request a tick later so the fast one is genuinely in flight.
      await delay(5);
      const slowStart = performance.now();
      const slowPromise = fetchWithTimeout(
        `http://127.0.0.1:${server.port}/async/concurrent/slow`,
      ).then(async (response) => ({
        elapsed: performance.now() - slowStart,
        status: response.status,
        body: await response.json(),
      }));

      const [fast, slow] = await Promise.all([fastPromise, slowPromise]);

      expect(fast.status).toBe(200);
      expect(slow.status).toBe(200);
      expect(fast.body.pace).toBe("fast");
      expect(slow.body.pace).toBe("slow");

      // Each request waited for its own delay, not for the other request.
      expect(fast.body.waited).toBeGreaterThanOrEqual(15);
      expect(fast.body.waited).toBeLessThan(100);
      expect(slow.body.waited).toBeGreaterThanOrEqual(100);
      expect(fast.elapsed).toBeGreaterThanOrEqual(15);
      expect(slow.elapsed).toBeGreaterThanOrEqual(100);
      // The fast request resolved well before the slow one, so they did not block each other.
      expect(fast.elapsed).toBeLessThan(slow.elapsed - 50);
    } finally {
      await server.stop(true);
    }
  });
});
