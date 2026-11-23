import { afterEach, describe, expect, it } from "bun:test";
import { Rossa, Websocket, wss } from "../../src/index";
import type { wssMessage } from "../../src/wss/config.wss";
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

function createBroadcastSocket(topic: string) {
  const path = `/broadcast-self-${crypto.randomUUID()}`;

  @wss(path)
  class BroadcastSocket extends Websocket {
    override open() {
      this.manager.subscribe(topic);
    }

    override message({ json }: wssMessage) {
      if (json.action !== "broadcast") return;
      this.manager.broadcast(
        [topic],
        { type: "chat", from: json.from, body: json.body },
        { includeSelf: json.includeSelf === true },
      );
    }
  }

  return { Socket: BroadcastSocket, path };
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

function connect(server: { port?: number | undefined }, path: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
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

describe("sender-inclusive topic broadcast", () => {
  it("stays sender-exclusive by default", async () => {
    const topic = `test:broadcast-default:${crypto.randomUUID()}`;
    const { Socket, path } = createBroadcastSocket(topic);
    const server = await startServer(Socket);

    const alice = connect(server, path);
    const bob = connect(server, path);
    await waitForOpen(alice.socket);
    await waitForOpen(bob.socket);

    alice.socket.send(
      JSON.stringify({ action: "broadcast", from: "alice", body: "hello" }),
    );

    expect(await bob.inbox.next()).toEqual({
      type: "chat",
      from: "alice",
      body: "hello",
    });
    expect(await alice.inbox.collect(150)).toEqual([]);
  });

  it("delivers the frame to the publishing socket when includeSelf is true", async () => {
    const topic = `test:broadcast-self:${crypto.randomUUID()}`;
    const { Socket, path } = createBroadcastSocket(topic);
    const server = await startServer(Socket);

    const alice = connect(server, path);
    const bob = connect(server, path);
    await waitForOpen(alice.socket);
    await waitForOpen(bob.socket);

    alice.socket.send(
      JSON.stringify({
        action: "broadcast",
        from: "alice",
        body: "echo me",
        includeSelf: true,
      }),
    );

    const expected = { type: "chat", from: "alice", body: "echo me" };
    expect(await alice.inbox.next()).toEqual(expected);
    expect(await bob.inbox.next()).toEqual(expected);
  });

  it("keeps both clients in order through a two-message exchange", async () => {
    const topic = `test:broadcast-exchange:${crypto.randomUUID()}`;
    const { Socket, path } = createBroadcastSocket(topic);
    const server = await startServer(Socket);

    const alice = connect(server, path);
    const bob = connect(server, path);
    await waitForOpen(alice.socket);
    await waitForOpen(bob.socket);

    alice.socket.send(
      JSON.stringify({
        action: "broadcast",
        from: "alice",
        body: "one",
        includeSelf: true,
      }),
    );
    bob.socket.send(
      JSON.stringify({
        action: "broadcast",
        from: "bob",
        body: "two",
        includeSelf: true,
      }),
    );

    for (const inbox of [alice.inbox, bob.inbox]) {
      expect(await inbox.next()).toEqual({
        type: "chat",
        from: "alice",
        body: "one",
      });
      expect(await inbox.next()).toEqual({
        type: "chat",
        from: "bob",
        body: "two",
      });
    }
  });
});
