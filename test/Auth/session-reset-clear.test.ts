import { describe, expect, it, spyOn } from "bun:test";
import { makeContext } from "../helpers";
import { session } from "../../src/guard/session.guard";
import { MemorySessionAuth } from "./in-memory-session-auth";

function cookieSid(cookie: string | null): string {
  expect(cookie).not.toBeNull();
  const match = cookie!.match(/^session=([^;]+)/);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("session.reset", () => {
  it("rotates, replaces every key, and persists the new session", async () => {
    const auth = new MemorySessionAuth();
    const guard = session(auth);

    let oldSid = "";
    const loginContext = makeContext(new Request("http://localhost/login"));
    const loginResponse = await guard(loginContext, async () => {
      (loginContext.session as any).legacy = "pre-auth";
      (loginContext.session as any).email = "user@example.com";
      oldSid = loginContext.session!.sid;
      return new Response("logged in");
    });

    expect(loginResponse.status).toBe(200);
    expect(auth.rows.get(oldSid)!.data).toEqual({
      legacy: "pre-auth",
      email: "user@example.com",
    });

    const resetContext = makeContext(
      new Request("http://localhost/login", {
        headers: { cookie: `session=${oldSid}` },
      }),
    );

    let newSid = "";
    const resetResponse = await guard(resetContext, async () => {
      await resetContext.session!.reset({ userId: 7, username: "ada" });
      newSid = resetContext.session!.sid;
      return new Response("ok");
    });

    expect(resetResponse.status).toBe(200);
    expect(newSid).not.toBe(oldSid);
    expect(resetContext.session!.length).toBe(2);

    // Old sid is unusable and its row is gone; only the replacement remains.
    expect(auth.rows.has(oldSid)).toBe(false);
    expect(auth.rows.has(newSid)).toBe(true);
    expect(auth.rows.get(newSid)!.data).toEqual({
      userId: 7,
      username: "ada",
    });
    expect(cookieSid(resetResponse.headers.get("set-cookie"))).toBe(newSid);

    const staleContext = makeContext(
      new Request("http://localhost/", {
        headers: { cookie: `session=${oldSid}` },
      }),
    );
    const staleResponse = await guard(staleContext, async () => new Response("ok"));

    expect(staleResponse.status).toBe(200);
    expect(staleContext.session!.isFound).toBe(false);
    expect(staleContext.session!.length).toBe(0);
  });

  it("is a no-op on a readonly mount", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const auth = new MemorySessionAuth();
      const writable = session(auth);

      const loginContext = makeContext(new Request("http://localhost/login"));
      await writable(loginContext, async () => {
        (loginContext.session as any).email = "user@example.com";
        return new Response("logged in");
      });

      const sid = loginContext.session!.sid;
      const readonly = session({ auth, readonly: true });
      const context = makeContext(
        new Request("http://localhost/", {
          headers: { cookie: `session=${sid}` },
        }),
      );

      const response = await readonly(context, async () => {
        await context.session!.reset({ userId: 99, role: "admin" });
        return new Response("ok");
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(context.session!.sid).toBe(sid);
      expect(context.session!.length).toBe(1);
      expect(auth.rows.get(sid)!.data).toEqual({ email: "user@example.com" });
    } finally {
      warn.mockRestore();
    }
  });
});

describe("session.clear", () => {
  it("removes every key so the guard deletes the row and expires the cookie", async () => {
    const auth = new MemorySessionAuth();
    const guard = session(auth);

    let sid = "";
    const loginContext = makeContext(new Request("http://localhost/login"));
    await guard(loginContext, async () => {
      (loginContext.session as any).userId = 7;
      (loginContext.session as any).username = "ada";
      sid = loginContext.session!.sid;
      return new Response("logged in");
    });

    expect(auth.rows.has(sid)).toBe(true);

    const logoutContext = makeContext(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { cookie: `session=${sid}` },
      }),
    );

    const logoutResponse = await guard(logoutContext, async () => {
      await logoutContext.session!.clear();
      return new Response("ok");
    });

    expect(logoutResponse.status).toBe(200);
    expect(auth.rows.has(sid)).toBe(false);
    expect(logoutContext.session!.length).toBe(0);

    const cookie = logoutResponse.headers.get("set-cookie");
    expect(cookie).not.toBeNull();
    expect(cookie!.startsWith(`session=${sid};`)).toBe(true);
    expect(cookie).toContain("Max-Age=0");

    const staleContext = makeContext(
      new Request("http://localhost/", {
        headers: { cookie: `session=${sid}` },
      }),
    );
    const staleResponse = await guard(staleContext, async () => new Response("ok"));

    expect(staleResponse.status).toBe(200);
    expect(staleContext.session!.isFound).toBe(false);
    expect(staleContext.session!.length).toBe(0);
    expect(auth.rows.has(sid)).toBe(false);
  });

  it("is a no-op on a readonly mount", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const auth = new MemorySessionAuth();
      const writable = session(auth);

      const loginContext = makeContext(new Request("http://localhost/login"));
      await writable(loginContext, async () => {
        (loginContext.session as any).email = "user@example.com";
        return new Response("logged in");
      });

      const sid = loginContext.session!.sid;
      const readonly = session({ auth, readonly: true });
      const context = makeContext(
        new Request("http://localhost/", {
          headers: { cookie: `session=${sid}` },
        }),
      );

      const response = await readonly(context, async () => {
        await context.session!.clear();
        return new Response("ok");
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(context.session!.length).toBe(1);
      expect(auth.rows.get(sid)!.data).toEqual({ email: "user@example.com" });
    } finally {
      warn.mockRestore();
    }
  });
});
