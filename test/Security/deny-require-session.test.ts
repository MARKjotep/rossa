import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  Methods,
  Rossa,
  SessionAuthInterface,
  type AuthConfig,
  type GuardReturnType,
  type ServerSide,
  deny,
  requireSession,
  route,
  session,
  use,
} from "../../src/index";
import type { ctx } from "../../src/index";
import { getFreePort, makeContext, runGuard } from "../helpers";

type AccountSession = {
  userId?: number;
};

/** In-memory session store so the lifecycle test needs no database. */
class MemorySessions extends SessionAuthInterface {
  readonly rows = new Map<
    string,
    { data: Record<string, any>; expiration: string }
  >();

  constructor(config: AuthConfig) {
    super(config, "deny-require-session-test-salt");
  }

  override async fetchData(sid: string) {
    return this.rows.get(sid);
  }

  override async saveSession(
    current: ServerSide,
    headers: Headers,
  ): Promise<void> {
    this.rows.set(current.sid, {
      data: current.data,
      expiration: this.getSessionExpirationDate.toISOString(),
    });
    this.setCookie(current, headers);
  }

  override async deleteSession(
    current: ServerSide,
    headers: Headers,
  ): Promise<void> {
    this.rows.delete(current.sid);
    this.removeCookie(current, headers);
  }
}

function createStore() {
  return new MemorySessions({
    COOKIE_NAME: "sid",
    COOKIE_PATH: "/",
    COOKIE_SECURE: false,
    COOKIE_SAMESITE: "Lax",
  });
}

/** Stores a session row directly and returns the matching signed sid. */
async function seedSession(
  store: MemorySessions,
  data: Record<string, any>,
  expiration = store.getSessionExpirationDate,
): Promise<string> {
  const sid = store.generate();
  store.rows.set(sid, { data, expiration: expiration.toISOString() });
  return sid;
}

const denySpy = spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  denySpy.mockClear();
});

// --- Un-invoked guard factories --------------------------------------------

const uninvokedGuard = deny as unknown as GuardReturnType;

@route("/uninvoked")
@use(uninvokedGuard)
class UninvokedRoute extends Methods {
  get({ res }: ctx): Response {
    return res.text("unreachable");
  }
}

@route("/plain")
class PlainRoute extends Methods {
  get({ res }: ctx): Response {
    return res.text("ok");
  }
}

// --- Live session lifecycle -------------------------------------------------

const lifecycleStore = createStore();

@route("/login")
@use(session(lifecycleStore))
class LoginRoute extends Methods {
  post({ session: current, res }: ctx): Response {
    (current as unknown as AccountSession).userId = 42;
    return res.json({ ok: true, userId: 42 });
  }
}

@route("/lifecycle")
@use(session(lifecycleStore), requireSession())
class LifecycleRoute extends Methods {
  get({ session: current, res }: ctx): Response {
    return res.json({
      userId: (current as unknown as AccountSession).userId,
    });
  }

  delete({ session: current, res }: ctx): Response {
    delete (current as unknown as AccountSession).userId;
    return res.json({ cleared: true });
  }
}

function readCookie(setCookie: string | null): string {
  const match = setCookie?.match(/^([^=]+)=([^;]+)/);
  if (!match) throw new Error(`Missing session cookie in: ${setCookie}`);
  return `${match[1]}=${match[2]}`;
}

describe("deny guard", () => {
  it("denies every request with 403 by default", async () => {
    const result = await runGuard(
      deny(),
      new Request("http://localhost/anything"),
    );

    expect(result.response.status).toBe(403);
    expect(result.nextCalls).toBe(0);
    expect(await result.response.json()).toEqual({
      success: false,
      error: "Forbidden",
    });
  });

  it("honors custom code and message", async () => {
    const result = await runGuard(
      deny({ code: 503, message: "Under maintenance" }),
      new Request("http://localhost/anything"),
    );

    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toEqual({
      success: false,
      error: "Under maintenance",
    });
  });

  it("redirects when a redirect target is configured", async () => {
    const result = await runGuard(
      deny({ code: 403, redirect: "/login" }),
      new Request("http://localhost/anything"),
    );

    expect(result.response.status).toBe(302);
    expect(result.response.headers.get("location")).toBe("/login");
  });

  it("passes non-matching requests and denies matching ones", async () => {
    const guard = deny({
      code: 403,
      when: (ctx) => ctx.req.method === "TRACE",
    });

    const get = await runGuard(guard, new Request("http://localhost/ping"));
    expect(get.response.status).toBe(200);
    expect(get.nextCalls).toBe(1);

    const trace = await runGuard(
      guard,
      new Request("http://localhost/ping", { method: "TRACE" }),
    );
    expect(trace.response.status).toBe(403);
    expect(trace.nextCalls).toBe(0);
  });
});

describe("requireSession guard", () => {
  it("rejects requests when session() never ran", async () => {
    const result = await runGuard(
      requireSession(),
      new Request("http://localhost/"),
    );

    expect(result.response.status).toBe(401);
    expect(result.nextCalls).toBe(0);
    expect(await result.response.json()).toEqual({
      success: false,
      error: "Authentication required",
    });
  });

  it("rejects anonymous sessions created without a valid cookie", async () => {
    const store = createStore();
    const context = makeContext(new Request("http://localhost/"));
    context.session = store.new({});

    expect(context.session.isFound).toBe(false);
    expect(context.session.isNew).toBe(true);

    const result = await runGuard(
      requireSession(),
      new Request("http://localhost/"),
      context,
    );
    expect(result.response.status).toBe(401);
    expect(result.nextCalls).toBe(0);
  });

  it("rejects invalid signatures, unknown sids, and expired rows", async () => {
    const store = createStore();

    const badSignature = await store.openSession("not-a-signed-sid");
    const unknownSid = await store.openSession(store.generate());
    const expiredSid = await seedSession(
      store,
      { userId: 7 },
      new Date(Date.now() - 60_000),
    );
    const expired = await store.openSession(expiredSid);

    const valid = await seedSession(store, { userId: 8 });
    const found = await store.openSession(valid);
    expect(found.isFound).toBe(true);
    expect(found.isNew).toBe(false);

    for (const candidate of [badSignature, unknownSid, expired]) {
      const context = makeContext(new Request("http://localhost/"));
      context.session = candidate;
      const result = await runGuard(
        requireSession(),
        new Request("http://localhost/"),
        context,
      );
      expect(result.response.status).toBe(401);
      expect(result.nextCalls).toBe(0);
    }

    const allowedContext = makeContext(new Request("http://localhost/"));
    allowedContext.session = found;
    const allowed = await runGuard(
      requireSession(),
      new Request("http://localhost/"),
      allowedContext,
    );
    expect(allowed.response.status).toBe(200);
    expect(allowed.nextCalls).toBe(1);
  });

  it("rejects store-backed sessions that fail the validator", async () => {
    const store = createStore();
    const sid = await seedSession(store, { userId: 9 });
    const found = await store.openSession(sid);

    const rejectedContext = makeContext(new Request("http://localhost/"));
    rejectedContext.session = found;
    const rejected = await runGuard(
      requireSession(() => false),
      new Request("http://localhost/"),
      rejectedContext,
    );
    expect(rejected.response.status).toBe(401);
    expect(rejected.nextCalls).toBe(0);

    const acceptedContext = makeContext(new Request("http://localhost/"));
    acceptedContext.session = found;
    const accepted = await runGuard(
      requireSession(
        (s) => typeof (s as unknown as AccountSession).userId === "number",
      ),
      new Request("http://localhost/"),
      acceptedContext,
    );
    expect(accepted.response.status).toBe(200);
    expect(accepted.nextCalls).toBe(1);
  });
});

describe("un-invoked guard factories answer 500", () => {
  it("returns 500 for a route-level factory that was never invoked", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(UninvokedRoute);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/uninvoked`,
      );
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("guard factory not invoked");
      expect(denySpy).toHaveBeenCalled();
    } finally {
      await server.stop(true);
    }
  });

  it("returns 500 for a global factory that was never invoked", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(uninvokedGuard);
    app.register(PlainRoute);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/plain`);
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("guard factory not invoked");
    } finally {
      await server.stop(true);
    }
  });
});

describe("session lifecycle against a live server", () => {
  it("creates a session on write, clears the cookie when emptied, then denies", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(LoginRoute);
    app.register(LifecycleRoute);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      // No session yet: requireSession rejects before the handler runs.
      const anonymous = await fetch(`${base}/lifecycle`);
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toEqual({
        success: false,
        error: "Authentication required",
      });

      // Login-style write persists the session and sets the cookie.
      const login = await fetch(`${base}/login`, { method: "POST" });
      expect(login.status).toBe(200);
      const cookie = readCookie(login.headers.get("set-cookie"));
      expect(cookie.startsWith("sid=")).toBe(true);

      // A stored, unexpired session passes requireSession().
      const allowed = await fetch(`${base}/lifecycle`, {
        headers: { cookie },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ userId: 42 });

      // Deleting the last session key clears the stored row and the cookie.
      const emptied = await fetch(`${base}/lifecycle`, {
        method: "DELETE",
        headers: { cookie },
      });
      expect(emptied.status).toBe(200);
      expect(await emptied.json()).toEqual({ cleared: true });
      const clearedCookie = emptied.headers.get("set-cookie");
      expect(clearedCookie).toContain("sid=");
      expect(clearedCookie).toContain("Max-Age=0");

      // The next request without a valid cookie is denied again.
      const denied = await fetch(`${base}/lifecycle`);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({
        success: false,
        error: "Authentication required",
      });
    } finally {
      await server.stop(true);
    }
  });
});
