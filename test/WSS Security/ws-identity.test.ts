import { afterEach, describe, expect, it } from "bun:test";
import { createGuard } from "../../src/guard/@/base.guard";
import { use } from "../../src/guard/@/@.guard";
import { Rossa, Websocket, wss } from "../../src/index";
import { getFreePort } from "../helpers";

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

type Identity = { id: string; nickname: string };
type SocketData = { sent: number };

function createIdentitySocket() {
  const path = `/ws-identity-${crypto.randomUUID()}`;

  const attachIdentity = createGuard<void>(async (ctx, next) => {
    const id = ctx.req.headers.get("x-user-id");
    const nickname = ctx.req.headers.get("x-user-name");
    if (!id || !nickname) return ctx.res.error(401, "Unauthorized");
    ctx.data.user = { id, nickname } satisfies Identity;
    return await next();
  })();

  @wss(path)
  @use(attachIdentity)
  class IdentitySocket extends Websocket<SocketData, Identity> {
    override open() {
      this.data.sent = 0;
      this.send = JSON.stringify({
        user: this.user,
        room: this.query.get("room"),
        token: this.query.get("token"),
        connectionId: this.ws.data.id,
      });
    }

    override message() {
      this.data.sent += 1;
      this.send = JSON.stringify({
        sent: this.data.sent,
        nickname: this.user.nickname,
      });
    }
  }

  return { Socket: IdentitySocket, path };
}

function createUntypedSocket() {
  const path = `/ws-identity-plain-${crypto.randomUUID()}`;

  @wss(path)
  class PlainSocket extends Websocket {
    override open() {
      this.data.anything = 1;
      this.send = JSON.stringify({
        value: this.data.anything,
        user: this.user,
        connectionId: this.ws.data.id,
      });
    }
  }

  return { Socket: PlainSocket, path };
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

async function connect(port: number, path: string, headers: Record<string, string>) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}?room=lobby&token=t1`, {
    headers,
  } as any);
  sockets.push(socket);

  const opened = new Promise<void>((resolve, reject) => {
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

  return { socket, opened };
}

function nextJson(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket frame")),
      2_000,
    );
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeoutId);
        try {
          resolve(JSON.parse(String(event.data)));
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
  });
}

describe("typed WebSocket identity", () => {
  it("exposes the guard-set user, query, and registered ws.data", async () => {
    const { Socket, path } = createIdentitySocket();
    const server = await startServer(Socket);

    const { socket, opened } = await connect(server.port!, path, {
      "x-user-id": "user-1",
      "x-user-name": "Alice",
    });
    const greetingPromise = nextJson(socket);
    await opened;

    const greeting = await greetingPromise;
    expect(greeting.user).toEqual({ id: "user-1", nickname: "Alice" });
    expect(greeting.room).toBe("lobby");
    expect(greeting.token).toBe("t1");
    expect(typeof greeting.connectionId).toBe("string");
    expect(greeting.connectionId.length).toBeGreaterThan(0);

    const reply = nextJson(socket);
    socket.send("ping");
    await expect(reply).resolves.toEqual({ sent: 1, nickname: "Alice" });
  });

  it("keeps untyped Websocket subclasses working", async () => {
    const { Socket, path } = createUntypedSocket();
    const server = await startServer(Socket);

    const { socket, opened } = await connect(server.port!, path, {});
    const greetingPromise = nextJson(socket);
    await opened;

    const greeting = await greetingPromise;
    expect(greeting.value).toBe(1);
    expect(greeting.user).toEqual({});
    expect(typeof greeting.connectionId).toBe("string");
  });
});
