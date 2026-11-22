import { describe, expect, it } from "bun:test";
import { makeContext } from "../helpers";
import { session } from "../../src/guard/session.guard";
import { MemorySessionAuth } from "./in-memory-session-auth";

function cookieSid(cookie: string | null): string {
  expect(cookie).not.toBeNull();
  const match = cookie!.match(/^session=([^;]+)/);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("session rotation", () => {
  it("mints a new signed sid, deletes the old row, and saves the new session", async () => {
    const auth = new MemorySessionAuth();
    const guard = session(auth);

    const loginContext = makeContext(new Request("http://localhost/login"));
    const loginResponse = await guard(loginContext, async () => {
      (loginContext.session as any).email = "user@example.com";
      return new Response("logged in");
    });

    expect(loginResponse.status).toBe(200);
    const oldSid = loginContext.session!.sid;
    expect(auth.rows.has(oldSid)).toBe(true);

    const rotateContext = makeContext(
      new Request("http://localhost/rotate", {
        headers: { cookie: `session=${oldSid}` },
      }),
    );

    let newSid: string | undefined;
    const rotateResponse = await guard(rotateContext, async () => {
      await rotateContext.session!.rotate();
      newSid = rotateContext.session!.sid;
      return new Response("rotated");
    });

    expect(rotateResponse.status).toBe(200);
    expect(newSid).toBeDefined();
    expect(newSid).not.toBe(oldSid);

    // Old sid unusable, new row saved with the same data and a fresh cookie.
    expect(auth.rows.has(oldSid!)).toBe(false);
    expect(auth.rows.has(newSid!)).toBe(true);
    expect(auth.rows.get(newSid!)!.data).toEqual({ email: "user@example.com" });
    expect(cookieSid(rotateResponse.headers.get("set-cookie"))).toBe(newSid!);

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

  it("discards handler writes on a readonly mount without a subclass", async () => {
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
      new Request("http://localhost/", { headers: { cookie: `session=${sid}` } }),
    );

    const response = await readonly(context, async () => {
      (context.session as any).email = "attacker@example.com";
      (context.session as any).role = "admin";
      return new Response("ok");
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((context.session as any).email).toBe("user@example.com");
    expect((context.session as any).role).toBeUndefined();
    expect(auth.rows.get(sid)!.data).toEqual({ email: "user@example.com" });
  });

  it("keeps the instance form working", () => {
    const auth = new MemorySessionAuth();
    expect(typeof session(auth)).toBe("function");
    expect(typeof session({ auth })).toBe("function");
  });
});
