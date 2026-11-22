import { describe, expect, it } from "bun:test";
import { makeContext } from "../helpers";
import {
  session,
  type SessionContext,
} from "../../src/guard/session.guard";
import { MemorySessionAuth } from "./in-memory-session-auth";

interface AccountSession {
  email: string;
  role: "admin" | "member";
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<_T extends true> = unknown;

// Compile-time guard: the generic context exposes typed data, not `any`.
type _TypedEmail = Expect<
  Equal<NonNullable<SessionContext<AccountSession>["session"]>["email"], string>
>;
type _TypedRole = Expect<
  Equal<
    NonNullable<SessionContext<AccountSession>["session"]>["role"],
    "admin" | "member"
  >
>;

describe("typed session mounts", () => {
  it("loads typed data through SessionContext without casting data fields", async () => {
    const auth = new MemorySessionAuth();
    const guard = session<AccountSession>(auth);

    const seed = auth.new({});
    seed.email = "user@example.com";
    seed.role = "member";
    await auth.saveSession(seed, new Headers());

    const context = makeContext(
      new Request("http://localhost/", {
        headers: { cookie: `session=${seed.sid}` },
      }),
    ) as unknown as SessionContext<AccountSession>;

    await guard(context, async () => {
      const email: string = context.session!.email;
      const role: "admin" | "member" = context.session!.role;
      expect(email).toBe("user@example.com");
      expect(role).toBe("member");
      return new Response("ok");
    });
  });

  it("keeps untyped mounts working", async () => {
    const auth = new MemorySessionAuth();
    const guard = session(auth);
    const context = makeContext(new Request("http://localhost/"));

    const response = await guard(context, async () => {
      (context.session as any).anything = "goes";
      return new Response("ok");
    });

    expect(response.status).toBe(200);
    expect(auth.rows.size).toBe(1);
  });
});
