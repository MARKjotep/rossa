import { afterEach, describe, expect, it } from "bun:test";
import { createGuard } from "../../src/guard/@/base.guard";
import { use } from "../../src/guard/@/@.guard";
import { Rossa, WSSMAN, Websocket, wss } from "../../src/index";
import type { WssConfig } from "../../src/wss/config.wss";
import { getFreePort } from "../helpers";

interface Inbox {
  next(timeoutMs?: number): Promise<any>;
  buffered: any[];
  collect(waitMs: number): Promise<any[]>;
}

function inboxFor(socket: WebSocket): Inbox {
  const buffered: any[] = [];
  const waiters: Array<{
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  socket.addEventListener("message", (event) => {
    let value: any;
    try {
      value = JSON.parse(String(event.data));
    } catch {
      value = String(event.data);
    }
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    } else {
      buffered.push(value);
    }
  });

  return {
    buffered,
    next(timeoutMs = 2_000) {
      if (buffered.length > 0) return Promise.resolve(buffered.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((entry) => entry.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for WebSocket frame"));
        }, timeoutMs);
        waiters.push({ resolve, reject, timer });
      });
    },
    async collect(waitMs: number) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return buffered.splice(0, buffered.length);
    },
  };
}

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> =
  [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  }
  sockets.length = 0;
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

function createPresenceSocket(
  topic: string,
  presence: WssConfig["presence"] = undefined,
) {
  const path = `/presence-events-${crypto.randomUUID()}`;

  const authenticate = createGuard<void>(async (ctx, next) => {
    const session = ctx.req.cookies.get("session");
    if (!session) return ctx.res.error(401, "Unauthorized");
    ctx.data.chatUser = { id: session, nickname: session };
    return await next();
  })();

  @wss(path)
  @use(authenticate)
  class PresenceSocket extends Websocket {
    override open() {
      this.manager.setTopicConfig(topic, {
        maxClients: 2,
        ...(presence === undefined ? {} : { presence }),
      });
      this.manager.subscribe(topic);
    }
  }

  return { Socket: PresenceSocket, path };
}

async function startServer(socketClass: typeof Websocket<{}>) {
  const app = new Rossa({ Encoding: "none" });
  app.registerWSS(socketClass);
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  servers.push(server);
  return server;
}

function connect(
  server: { port?: number | undefined },
  path: string,
  session: string,
) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, {
    headers: { Cookie: `session=${session}` },
  } as any);
  sockets.push(socket);
  const inbox = inboxFor(socket);
  return { socket, inbox };
}

async function waitForOpen(socket: WebSocket) {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error("Timed out opening WebSocket")),
      2_000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeoutId);
        reject(new Error("WebSocket handshake failed"));
      },
      { once: true },
    );
  });
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(10);
  }
  expect(check()).toBe(true);
}

function waitForClose(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
  });
}

describe("topic presence events", () => {
  it("emits join and leave frames, exposes typed members, and frees the slot", async () => {
    const topic = `test:presence:${crypto.randomUUID()}`;
    const { Socket, path } = createPresenceSocket(topic, true);
    const server = await startServer(Socket);

    const alice = connect(server, path, "alice");
    await waitForOpen(alice.socket);
    const aliceJoin = await alice.inbox.next();
    expect(aliceJoin).toMatchObject({
      type: "join",
      topic,
      member: { nickname: "alice", userId: "alice" },
      members: [{ nickname: "alice", userId: "alice" }],
    });
    expect(typeof aliceJoin.member.id).toBe("string");
    expect(aliceJoin.members[0].id).toBe(aliceJoin.member.id);

    const bob = connect(server, path, "bob");
    await waitForOpen(bob.socket);
    const bobJoin = await bob.inbox.next();
    const aliceSawBobJoin = await alice.inbox.next();
    expect(bobJoin.member).toEqual(aliceSawBobJoin.member);
    expect(bobJoin.members.map((member: any) => member.nickname)).toEqual([
      "alice",
      "bob",
    ]);
    expect(aliceSawBobJoin.members).toHaveLength(2);

    const roster = WSSMAN.members(topic);
    expect(roster.map((member) => member.nickname)).toEqual(["alice", "bob"]);
    expect(roster.map((member) => member.userId)).toEqual(["alice", "bob"]);
    for (const member of roster) expect(typeof member.id).toBe("string");

    const bobClosed = waitForClose(bob.socket);
    bob.socket.close();
    await bobClosed;

    const leave = await alice.inbox.next();
    expect(leave).toMatchObject({
      type: "leave",
      topic,
      member: { nickname: "bob", userId: "bob" },
    });
    expect(leave.member.id).toBe(bobJoin.member.id);
    expect(leave.members.map((member: any) => member.nickname)).toEqual([
      "alice",
    ]);
    await waitFor(() => WSSMAN.members(topic).length === 1);
    expect(WSSMAN.members(topic).some((m) => m.id === bobJoin.member.id)).toBe(
      false,
    );

    // The maxClients slot is free again: a third socket can still join.
    const carol = connect(server, path, "carol");
    await waitForOpen(carol.socket);
    const carolJoin = await carol.inbox.next();
    expect(carolJoin.type).toBe("join");
    expect(carolJoin.members.map((member: any) => member.nickname)).toEqual([
      "alice",
      "carol",
    ]);
  });

  it("emits no extra frames without presence config", async () => {
    const topic = `test:presence-off:${crypto.randomUUID()}`;
    const { Socket, path } = createPresenceSocket(topic);
    const server = await startServer(Socket);

    const alice = connect(server, path, "alice");
    await waitForOpen(alice.socket);

    expect(await alice.inbox.collect(200)).toEqual([]);
    expect(WSSMAN.members(topic)).toHaveLength(1);
  });
});
