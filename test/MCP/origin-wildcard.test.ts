import { describe, expect, it } from "bun:test";
import { McpServer, Rossa } from "../../src/index";

const PROTOCOL_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
};

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "rossa-origin-test", version: "1.0.0" },
  },
};

function createTestServer(): McpServer {
  const server = new McpServer({ name: "rossa-origin-test", version: "0.0.0" });
  server.registerTool(
    "ping",
    { description: "Always answers ok" },
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  );
  return server;
}

function createApp(origin?: string | string[]): Rossa {
  const app = new Rossa({ Encoding: "none" });
  if (origin === undefined) {
    app.registerMCP("/mcp", () => createTestServer());
  } else {
    app.registerMCP("/mcp", () => createTestServer(), { origin });
  }
  return app;
}

function post(app: Rossa, origin?: string): Promise<Response> {
  const headers: Record<string, string> = { ...PROTOCOL_HEADERS };
  if (origin !== undefined) headers.origin = origin;
  return app.test(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(INITIALIZE),
    }),
  );
}

describe("MCP origin scheme wildcards", () => {
  it("https://* allows any https origin and rejects http", async () => {
    const app = createApp(["https://*"]);

    expect((await post(app, "https://anything.example")).status).toBe(200);
    expect((await post(app, "https://app.example.com:8443")).status).toBe(200);

    const http = await post(app, "http://anything.example");
    expect(http.status).toBe(403);
    expect(await http.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid Origin: anything.example" },
      id: null,
    });
  });

  it("http://* allows any http origin and rejects https", async () => {
    const app = createApp(["http://*"]);

    expect((await post(app, "http://anything.example")).status).toBe(200);
    expect((await post(app, "http://localhost:3000")).status).toBe(200);

    const https = await post(app, "https://anything.example");
    expect(https.status).toBe(403);
    expect(await https.json()).toMatchObject({
      error: { code: -32000, message: "Invalid Origin: anything.example" },
    });
  });

  it("matches scheme wildcards case-insensitively", async () => {
    const app = createApp(["HTTPS://*"]);
    expect((await post(app, "https://anything.example")).status).toBe(200);
  });

  it("keeps non-http(s) wildcards on the SDK path (moz-extension://*)", async () => {
    const app = createApp(["moz-extension://*"]);

    expect((await post(app, "moz-extension://abc-123")).status).toBe(200);

    const https = await post(app, "https://anything.example");
    expect(https.status).toBe(403);
  });

  it("keeps exact origins exact (scheme, host, and port)", async () => {
    const app = createApp(["https://trusted.example:8443"]);

    expect((await post(app, "https://trusted.example:8443")).status).toBe(200);

    // Port and scheme variants do not match an exact origin.
    expect((await post(app, "https://trusted.example")).status).toBe(403);
    expect((await post(app, "http://trusted.example:8443")).status).toBe(403);
    expect((await post(app, "https://evil.example:8443")).status).toBe(403);
  });

  it("keeps plain hostname entries port-agnostic across schemes", async () => {
    const app = createApp(["trusted.example"]);

    expect((await post(app, "https://trusted.example")).status).toBe(200);
    expect((await post(app, "http://trusted.example:8080")).status).toBe(200);
    expect((await post(app, "https://evil.example")).status).toBe(403);
  });

  it("combines scheme wildcards with exact entries", async () => {
    const app = createApp(["https://*", "http://localhost:3000"]);

    expect((await post(app, "https://anything.example")).status).toBe(200);
    expect((await post(app, "http://localhost:3000")).status).toBe(200);
    expect((await post(app, "http://localhost:3001")).status).toBe(403);
  });

  it("keeps the default (no origin option) permissive", async () => {
    const app = createApp();

    expect((await post(app, "https://anything.example")).status).toBe(200);
    expect((await post(app, "http://anything.example")).status).toBe(200);
    expect((await post(app)).status).toBe(200);
  });

  it("still rejects missing or malformed origins when configured", async () => {
    const app = createApp(["https://*"]);

    // Missing Origin headers remain allowed for non-browser clients.
    expect((await post(app)).status).toBe(200);

    // Opaque origins never match a scheme wildcard.
    expect((await post(app, "null")).status).toBe(403);
  });
});
