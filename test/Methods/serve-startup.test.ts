import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Rossa } from "../../src/core/rossa.core";

const servers: Bun.Server<any>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    try {
      server.stop(true);
    } catch {
      // already stopped
    }
  }
});

const infoCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");

describe("serve startup contract", () => {
  it("reports the bound ephemeral port to the ready callback", () => {
    const app = new Rossa({ Encoding: "none" });
    let seenPort: number | undefined;
    let seenServer: Bun.Server<any> | undefined;

    const server = app.serve({
      hostname: "127.0.0.1",
      port: 0,
      fn: (port, bound) => {
        seenPort = port;
        seenServer = bound;
      },
    });
    servers.push(server);

    expect(server.port).toBeGreaterThan(0);
    expect(seenPort).toBe(server.port);
    expect(seenServer).toBe(server);
  });

  it("logs the bound host and ephemeral port instead of localhost", () => {
    const info = spyOn(console, "info");
    const app = new Rossa({ Encoding: "none" });

    try {
      const server = app.serve({ hostname: "127.0.0.1", port: 0 });
      servers.push(server);

      const logged = infoCalls(info);
      expect(logged).toContain(`127.0.0.1:${server.port}`);
      expect(logged).not.toContain("localhost");
    } finally {
      info.mockRestore();
    }
  });

  it("logs an https URL when TLS is configured", async () => {
    const certificate = await Bun.file(
      new URL("../fixtures/localhost-cert.pem", import.meta.url),
    ).text();
    const privateKey = await Bun.file(
      new URL("../fixtures/localhost-key.pem", import.meta.url),
    ).text();

    const info = spyOn(console, "info");
    const app = new Rossa({ Encoding: "none" });

    try {
      const server = app.serve({
        hostname: "127.0.0.1",
        port: 0,
        tls: { cert: certificate, key: privateKey },
      });
      servers.push(server);

      expect(infoCalls(info)).toContain(`https://127.0.0.1:${server.port}`);
    } finally {
      info.mockRestore();
    }
  });
});
