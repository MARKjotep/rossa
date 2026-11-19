import { afterEach, describe, expect, it, mock } from "bun:test";
import { use } from "../../src/guard/@/@.guard";
import { authBearer } from "../../src/guard/auth.guard";
import { Rossa, Websocket, WSSMAN, wss } from "../../src/index";
import { WssManager } from "../../src/wss/wss-manager";
import { getFreePort } from "../helpers";

const requireToken = authBearer((_ctx, token) => token === "test-valid-token");

@wss("/protected-socket")
@use(requireToken)
class ProtectedSocket extends Websocket {
  override open() {
    this.send = JSON.stringify({ type: "authorized" });
  }
}

@wss("/limited-socket")
class LimitedSocket extends Websocket {
  override open() {
    this.send = JSON.stringify({ type: "ready" });
  }
}

@wss("/rate-limited-socket")
class RateLimitedSocket extends Websocket {
  static handled = 0;

  override message() {
    RateLimitedSocket.handled += 1;
  }
}

const cycleTopic = `test:cycle:${crypto.randomUUID()}`;

@wss("/cycle-socket")
class CycleSocket extends Websocket {
  override open() {
    this.manager.subscribe(cycleTopic);
  }

  override message() {
    this.send = "ack";
  }
}

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
  sockets.length = 0;
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

function waitForJson(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 2_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeoutId);
      try {
        resolve(JSON.parse(String(event.data)));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("WebSocket connection failed"));
    }, { once: true });
  });
}

function waitForHandshakeResult(socket: WebSocket): Promise<"open" | "error"> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve("open"), 2_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve("open");
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      resolve("error");
    }, { once: true });
  });
}

describe("WebSocket authorization and abuse limits", () => {
  it("rejects an unauthorized handshake and accepts a valid bearer token", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerWSS(ProtectedSocket);
    const server = app.serve({ hostname: "127.0.0.1", port: await getFreePort() });
    servers.push(server);

    const denied = new WebSocket(`ws://127.0.0.1:${server.port}/protected-socket`);
    sockets.push(denied);
    expect(await waitForHandshakeResult(denied)).toBe("error");

    const allowed = new WebSocket(
      `ws://127.0.0.1:${server.port}/protected-socket`,
      { headers: { Authorization: "Bearer test-valid-token" } } as any,
    );
    sockets.push(allowed);
    await expect(waitForJson(allowed)).resolves.toEqual({ type: "authorized" });
  });

  it("closes connections that exceed Bun's configured incoming frame size", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerWSS(LimitedSocket);
    const server = app.serve(
      { hostname: "127.0.0.1", port: await getFreePort() },
      { maxPayloadLength: 32 },
    );
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/limited-socket`);
    sockets.push(socket);
    await expect(waitForJson(socket)).resolves.toEqual({ type: "ready" });

    const closed = new Promise<CloseEvent>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for size-limit close")), 2_000);
      socket.addEventListener("close", (event) => {
        clearTimeout(timeoutId);
        resolve(event);
      }, { once: true });
    });
    socket.send("x".repeat(128));
    expect((await closed).code).toBe(1009);
  });

  it("closes a socket after its configured message burst and skips the excess handler call", async () => {
    RateLimitedSocket.handled = 0;
    const app = new Rossa({ Encoding: "none" });
    app.registerWSS(RateLimitedSocket);
    const server = app.serve(
      { hostname: "127.0.0.1", port: await getFreePort() },
      { messageRateLimit: { max: 2, windowMs: 60_000 } },
    );
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/rate-limited-socket`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
    });

    const closed = new Promise<CloseEvent>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for rate-limit close")), 2_000);
      socket.addEventListener("close", (event) => {
        clearTimeout(timeoutId);
        resolve(event);
      }, { once: true });
    });
    socket.send("one");
    socket.send("two");
    socket.send("three");

    expect((await closed).code).toBe(1008);
    expect(RateLimitedSocket.handled).toBe(2);
  });

  it("cleans topic membership across repeated connection cycles", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerWSS(CycleSocket);
    const server = app.serve(
      { hostname: "127.0.0.1", port: await getFreePort() },
      { messageRateLimit: { max: 1, windowMs: 60_000 } },
    );
    servers.push(server);

    for (let index = 0; index < 5; index += 1) {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/cycle-socket`);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
      });
      const ack = new Promise<string>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for cycle ack")), 2_000);
        socket.addEventListener("message", (event) => {
          clearTimeout(timeoutId);
          resolve(String(event.data));
        }, { once: true });
      });
      socket.send("ping");
      await expect(ack).resolves.toBe("ack");
      const closed = new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
      });
      socket.close();
      await closed;
      expect(WSSMAN.get(cycleTopic)).toHaveLength(0);
    }
  });
});

describe("WSS manager capacity and publish limits", () => {
  function fakeSocket() {
    return {
      data: {},
      subscribe: () => true,
      unsubscribe: () => true,
      publish: mock(() => 1),
    };
  }

  it("enforces room capacity and skips payloads over the configured byte limit", () => {
    const manager = new WssManager();
    const topic = `test:limits:${crypto.randomUUID()}`;
    const firstSocket = fakeSocket();
    const secondSocket = fakeSocket();
    const firstId = manager.register(firstSocket as any);
    const secondId = manager.register(secondSocket as any);
    manager.setTopicConfig(topic, { maxClients: 1, maxPayloadSize: 8 });

    manager.subscribe(firstId, topic);
    expect(() => manager.subscribe(secondId, topic)).toThrow("Topic capacity reached");

    expect(manager.broadcastToTopics(firstSocket as any, [topic], "123456789"))
      .toEqual([{ topic, status: "oversize" }]);
    expect(firstSocket.publish).not.toHaveBeenCalled();
    firstSocket.publish.mockReturnValueOnce(-1);
    expect(manager.broadcastToTopics(firstSocket as any, [topic], "12345678"))
      .toEqual([{ topic, status: "backpressured" }]);
    firstSocket.publish.mockReturnValueOnce(0);
    expect(manager.broadcastToTopics(firstSocket as any, [topic], "12345678"))
      .toEqual([{ topic, status: "dropped" }]);
    firstSocket.publish.mockReturnValueOnce(8);
    expect(manager.broadcastToTopics(firstSocket as any, [topic], "12345678"))
      .toEqual([{ topic, status: "sent" }]);
    expect(firstSocket.publish).toHaveBeenCalledWith(topic, "12345678");

    manager.cleanup(firstId);
    manager.cleanup(secondId);
  });
});
