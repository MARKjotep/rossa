import { afterEach, describe, expect, it } from "bun:test";
import { createConnection } from "node:net";
import { Rossa, WSSMAN, Websocket, wss } from "../../src/index";
import { getFreePort } from "../helpers";

const capacityTopic = `test:upgrade-capacity:${crypto.randomUUID()}`;
let opened = 0;

@wss("/capacity-socket")
class CapacitySocket extends Websocket {
  override capacityTopics() {
    return [capacityTopic];
  }

  override open() {
    opened += 1;
    this.manager.subscribe(capacityTopic);
    this.send = "ready";
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
  opened = 0;
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

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
  });
}

/** Sends a raw WebSocket upgrade request and returns the HTTP status line. */
function rawUpgradeStatus(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${Buffer.from(crypto.randomUUID()).toString("base64")}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });

    let data = "";
    const timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for upgrade response"));
    }, 2_000);

    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (!data.includes("\r\n\r\n")) return;
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(data.split("\r\n")[0] ?? "");
    });
    socket.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function waitForMembers(topic: string, count: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (WSSMAN.get(topic).length === count) return;
    await Bun.sleep(10);
  }
  expect(WSSMAN.get(topic)).toHaveLength(count);
}

describe("pre-handshake WebSocket topic capacity", () => {
  it("rejects an over-capacity upgrade with 503 before any socket opens", async () => {
    WSSMAN.setTopicConfig(capacityTopic, { maxClients: 1 });

    const app = new Rossa({ Encoding: "none" });
    app.registerWSS(CapacitySocket);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });
    servers.push(server);

    const first = new WebSocket(
      `ws://127.0.0.1:${server.port}/capacity-socket`,
    );
    sockets.push(first);
    await expect(waitForMessage(first)).resolves.toBe("ready");
    expect(opened).toBe(1);
    expect(WSSMAN.get(capacityTopic)).toHaveLength(1);

    const status = await rawUpgradeStatus(
      server.port!,
      "/capacity-socket",
    );
    expect(status).toContain("503");
    expect(opened).toBe(1);
    expect(WSSMAN.get(capacityTopic)).toHaveLength(1);

    const closed = waitForClose(first);
    first.close();
    await closed;
    await waitForMembers(capacityTopic, 0);

    const replacement = new WebSocket(
      `ws://127.0.0.1:${server.port}/capacity-socket`,
    );
    sockets.push(replacement);
    await expect(waitForMessage(replacement)).resolves.toBe("ready");
    expect(opened).toBe(2);
    expect(WSSMAN.get(capacityTopic)).toHaveLength(1);
  });
});
