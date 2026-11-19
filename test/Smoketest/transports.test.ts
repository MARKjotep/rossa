import { afterEach, describe, expect, it } from "bun:test";
import { createGuard } from "../../src/guard/@/base.guard";
import { use } from "../../src/guard/@/@.guard";
import { Methods, Rossa, route, wss, Websocket } from "../../src/index";
import type { wssMessage } from "../../src/wss/config.wss";
import { getFreePort } from "../helpers";

@route("/secure-health")
class SecureHealth extends Methods {
  get({ res }: { res: any }): Response {
    return res.json({ secure: true });
  }
}

const attachTrustedIdentity = createGuard<void>(async (ctx, next) => {
  ctx.data.principal = { id: "test-user" };
  return await next();
})();

@wss("/socket")
@use(attachTrustedIdentity)
class TransportSocket extends Websocket {
  override open() {
    this.manager.subscribe("test:transport-room");
    this.send = JSON.stringify({
      type: "ready",
      principal: this.contextData.principal,
    });
  }

  override message({ json }: wssMessage) {
    this.manager.broadcast(["test:transport-room"], {
      type: "chat",
      value: json.value,
    });
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

function waitForJson(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message")),
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

describe("Rossa HTTP transports", () => {
  it("serves HTTPS with Bun TLS options and stops cleanly", async () => {
    const certificate = await Bun.file(
      new URL("../fixtures/localhost-cert.pem", import.meta.url),
    ).text();
    const privateKey = await Bun.file(
      new URL("../fixtures/localhost-key.pem", import.meta.url),
    ).text();

    const app = new Rossa({ Encoding: "none" });
    app.register(SecureHealth);
    const port = await getFreePort();
    const server = app.serve({
      hostname: "127.0.0.1",
      port,
      tls: { cert: certificate, key: privateKey },
    });
    servers.push(server);

    // Trust the local fixture as a CA so Bun verifies both the certificate
    // chain and the localhost SAN instead of disabling TLS verification.
    const response = await fetch(
      `https://localhost:${server.port}/secure-health`,
      {
        tls: { ca: certificate },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ secure: true });
  });

  it("upgrades WebSockets, carries guarded identity, and publishes to room members", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerWSS(TransportSocket);
    const server = app.serve({
      hostname: "127.0.0.1",
      port: await getFreePort(),
    });
    servers.push(server);

    const first = new WebSocket(`ws://127.0.0.1:${server.port}/socket`);
    const firstReadyPromise = waitForJson(first);
    sockets.push(first);
    const firstReady = await firstReadyPromise;
    expect(firstReady).toEqual({
      type: "ready",
      principal: { id: "test-user" },
    });

    const second = new WebSocket(`ws://127.0.0.1:${server.port}/socket`);
    const secondReadyPromise = waitForJson(second);
    sockets.push(second);
    const secondReady = await secondReadyPromise;
    expect(secondReady.principal).toEqual({ id: "test-user" });

    const deliveredPromise = waitForJson(second);
    first.send(JSON.stringify({ value: "hello-room" }));
    await expect(deliveredPromise).resolves.toEqual({
      type: "chat",
      value: "hello-room",
    });
  });
});
