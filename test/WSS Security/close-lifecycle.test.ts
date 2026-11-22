import { afterEach, describe, expect, it } from "bun:test";
import { Rossa, WSSMAN, Websocket, wss } from "../../src/index";
import { getFreePort } from "../helpers";

const lifecycleTopic = `test:close-lifecycle:${crypto.randomUUID()}`;
const lifecycle: string[] = [];
let deprecatedCloseCalls = 0;

@wss("/close-hook-socket")
class CloseHookSocket extends Websocket {
  override open() {
    this.manager.subscribe(lifecycleTopic);
    this.send = "ready";
  }

  override onClose(_code: number, _reason: string) {
    lifecycle.push(
      this.manager.isSubscribed(lifecycleTopic)
        ? "before-cleanup"
        : "after-cleanup",
    );
    lifecycle.push(`members:${WSSMAN.get(lifecycleTopic).length}`);
  }
}

@wss("/deprecated-close-socket")
class DeprecatedCloseSocket extends Websocket {
  override close() {
    deprecatedCloseCalls += 1;
  }
}

@wss("/terminate-socket")
class TerminateSocket extends Websocket {
  override open() {
    this.terminate(4001, "application shutdown");
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
  lifecycle.length = 0;
  deprecatedCloseCalls = 0;
});

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message")),
      2_000,
    );
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeoutId);
        resolve(String(event.data));
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeoutId);
        reject(new Error("WebSocket connection failed"));
      },
      { once: true },
    );
  });
}

function waitForClose(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve({ code: socket.readyState, reason: "" });
      return;
    }
    socket.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    );
  });
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

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(10);
  }
  expect(check()).toBe(true);
}

describe("WebSocket close lifecycle", () => {
  it("runs onClose before manager.cleanup()", async () => {
    const server = await startServer(CloseHookSocket);
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/close-hook-socket`,
    );
    sockets.push(socket);
    await expect(waitForMessage(socket)).resolves.toBe("ready");

    const closed = waitForClose(socket);
    socket.close();
    await closed;
    await waitFor(() => lifecycle.length === 2);

    expect(lifecycle[0]).toBe("before-cleanup");
    expect(lifecycle[1]).toBe("members:1");
    await waitFor(() => WSSMAN.get(lifecycleTopic).length === 0);
  });

  it("still invokes a subclass that overrides the deprecated close() alias", async () => {
    const server = await startServer(DeprecatedCloseSocket);
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/deprecated-close-socket`,
    );
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("WebSocket connection failed")),
        { once: true },
      );
    });

    const closed = waitForClose(socket);
    socket.close();
    await closed;
    await waitFor(() => deprecatedCloseCalls === 1);
  });

  it("closes the connection from app code through terminate()", async () => {
    const server = await startServer(TerminateSocket);
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/terminate-socket`,
    );
    sockets.push(socket);
    const event = await waitForClose(socket);
    expect(event.code).toBe(4001);
    expect(event.reason).toBe("application shutdown");
  });
});
