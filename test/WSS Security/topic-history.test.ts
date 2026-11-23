import { afterEach, describe, expect, it } from "bun:test";
import { Rossa, Websocket, wss } from "../../src/index";
import type {
  TopicHistoryStore,
  WssHistoryConfig,
} from "../../src/wss/config.wss";
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

class MemoryHistory implements TopicHistoryStore {
  frames = new Map<string, unknown[]>();
  saves = 0;

  async save(topic: string, frame: unknown) {
    await Promise.resolve();
    this.saves += 1;
    const list = this.frames.get(topic) ?? [];
    list.push(frame);
    this.frames.set(topic, list);
  }

  async recent(topic: string, limit: number) {
    const list = this.frames.get(topic) ?? [];
    return list.slice(Math.max(0, list.length - limit));
  }
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

function createHistorySocket(
  topic: string,
  store: TopicHistoryStore,
  history: Omit<WssHistoryConfig, "store"> = {},
) {
  const path = `/topic-history-${crypto.randomUUID()}`;
  const settings: WssHistoryConfig = { store, ...history };

  @wss(path)
  class HistorySocket extends Websocket {
    override open() {
      this.manager.setTopicConfig(topic, { history: settings });
      this.manager.subscribe(topic);
    }

    override message({ json }: wssMessage) {
      const frame: Record<string, unknown> = {
        type: "chat",
        body: json.body,
      };
      if (json.skip) frame.skip = true;
      this.manager.broadcast([topic], frame);
    }
  }

  return { Socket: HistorySocket, path };
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
) {
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

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(5);
  }
  expect(check()).toBe(true);
}

describe("pluggable topic history", () => {
  it("persists accepted frames and replays the last `limit` oldest → newest", async () => {
    const topic = `test:history:${crypto.randomUUID()}`;
    const store = new MemoryHistory();
    const { Socket, path } = createHistorySocket(topic, store, {
      limit: 5,
      persist: (frame) => (frame as { skip?: boolean }).skip !== true,
    });
    const server = await startServer(Socket);

    const alice = connect(server, path);
    await waitForOpen(alice.socket);

    for (let index = 1; index <= 6; index += 1) {
      alice.socket.send(JSON.stringify({ body: `message-${index}` }));
    }
    alice.socket.send(JSON.stringify({ body: "skip-me", skip: true }));

    await waitFor(() => store.saves === 6);
    expect(store.frames.get(topic)).toHaveLength(6);
    expect(
      (store.frames.get(topic) ?? []).some(
        (frame) => (frame as { skip?: boolean }).skip === true,
      ),
    ).toBe(false);

    const bob = connect(server, path);
    await waitForOpen(bob.socket);

    for (let index = 2; index <= 6; index += 1) {
      const frame = await bob.inbox.next();
      expect(frame).toEqual({ type: "chat", body: `message-${index}` });
    }
    expect(await bob.inbox.collect(150)).toEqual([]);
  });

  it("keeps persisted history across a server restart", async () => {
    const topic = `test:history-restart:${crypto.randomUUID()}`;
    const store = new MemoryHistory();
    const first = createHistorySocket(topic, store);
    const firstServer = await startServer(first.Socket);

    const alice = connect(firstServer, first.path);
    await waitForOpen(alice.socket);
    alice.socket.send(JSON.stringify({ body: "before-restart" }));
    await waitFor(() => store.saves === 1);

    await firstServer.stop(true);
    servers.splice(servers.indexOf(firstServer), 1);

    const second = createHistorySocket(topic, store);
    const secondServer = await startServer(second.Socket);
    const bob = connect(secondServer, second.path);
    await waitForOpen(bob.socket);

    expect(await bob.inbox.next()).toEqual({
      type: "chat",
      body: "before-restart",
    });
  });

  it("persists without replaying when replay is false", async () => {
    const topic = `test:history-no-replay:${crypto.randomUUID()}`;
    const store = new MemoryHistory();
    const { Socket, path } = createHistorySocket(topic, store, {
      replay: false,
    });
    const server = await startServer(Socket);

    const alice = connect(server, path);
    await waitForOpen(alice.socket);
    alice.socket.send(JSON.stringify({ body: "stored-only" }));
    await waitFor(() => store.saves === 1);

    const bob = connect(server, path);
    await waitForOpen(bob.socket);
    expect(await bob.inbox.collect(200)).toEqual([]);
  });
});
