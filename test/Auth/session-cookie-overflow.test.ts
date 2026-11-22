import { describe, expect, it } from "bun:test";
import { makeContext } from "../helpers";
import { session } from "../../src/guard/session.guard";
import { MemorySessionAuth } from "./in-memory-session-auth";

describe("session cookie serialization", () => {
  it("rejects a MAX_COOKIE_SIZE overflow before persisting an orphan row", async () => {
    const auth = new MemorySessionAuth({ MAX_COOKIE_SIZE: 80 });
    const guard = session(auth);

    const context = makeContext(
      new Request("http://localhost/login", { method: "POST" }),
    );

    const response = await guard(context, async () => {
      (context.session as any).userId = "user-1";
      return new Response("logged in", { status: 200 });
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(auth.rows.size).toBe(0);
    expect(auth.saveCalls).toBe(0);

    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal Server Error");
  });

  it("still persists and sets a cookie for a normal size budget", async () => {
    const auth = new MemorySessionAuth();
    const guard = session(auth);

    const context = makeContext(new Request("http://localhost/login"));
    const response = await guard(context, async () => {
      (context.session as any).userId = "user-1";
      return new Response("logged in");
    });

    expect(response.status).toBe(200);
    expect(auth.rows.size).toBe(1);
    expect(auth.saveCalls).toBe(1);
    expect(response.headers.get("set-cookie")).toContain("session=");
  });
});
