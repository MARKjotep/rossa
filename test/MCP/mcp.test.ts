import { describe, expect, it } from "bun:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import {
  McpServer,
  Methods,
  Rossa,
  header,
  route,
} from "../../src/index";
import type { ctx } from "../../src/http/ctx";

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
    clientInfo: { name: "rossa-test-client", version: "1.0.0" },
  },
};

let factoryCalls = 0;

function createTestServer(toolName = "echo"): McpServer {
  factoryCalls += 1;
  const server = new McpServer({ name: "rossa-test", version: "0.0.0" });
  server.registerTool(
    toolName,
    { description: "Echo a fixed value" },
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  );
  return server;
}

function post(
  app: Rossa,
  body: unknown,
  headers: Record<string, string> = {},
  url = "http://localhost/mcp",
): Promise<Response> {
  return app.test(
    new Request(url, {
      method: "POST",
      headers: { ...PROTOCOL_HEADERS, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Reads either a JSON response body or the first SSE `data:` frame. */
async function readJsonRpc(response: Response): Promise<any> {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const frame = text
      .split("\n")
      .find((line) => line.startsWith("data: "));
    expect(frame).toBeDefined();
    return JSON.parse(frame!.slice("data: ".length));
  }
  return JSON.parse(text);
}

describe("MCP over Rossa", () => {
  it("runs an initialize and tools/list round-trip through app.test", async () => {
    factoryCalls = 0;
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP("/mcp", () => createTestServer());

    const initialized = await post(app, INITIALIZE);
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const init = await readJsonRpc(initialized);
    expect(init.jsonrpc).toBe("2.0");
    expect(init.id).toBe(1);
    expect(init.result.serverInfo).toEqual({
      name: "rossa-test",
      version: "0.0.0",
    });

    const listed = await post(app, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(listed.status).toBe(200);
    const list = await readJsonRpc(listed);
    expect(list.jsonrpc).toBe("2.0");
    expect(list.id).toBe(2);
    expect(list.result.tools).toEqual([
      {
        name: "echo",
        description: "Echo a fixed value",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    expect(factoryCalls).toBe(2);
  });

  it("serves the 2026-07-28 modern revision with per-request context", async () => {
    const eras: string[] = [];
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP("/mcp", (context) => {
      eras.push(context.era);
      return createTestServer();
    });

    const response = await app.test(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          ...PROTOCOL_HEADERS,
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/list",
          params: {
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
              [CLIENT_CAPABILITIES_META_KEY]: {},
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as any;
    expect(body.result.tools[0].name).toBe("echo");
    expect(body.result.resultType).toBe("complete");
    expect(eras).toEqual(["modern"]);
  });

  it("runs global guards before the MCP handler", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(header("x-mcp-key"));
    app.registerMCP("/mcp", () => createTestServer());

    const blocked = await post(app, INITIALIZE);
    expect(blocked.status).toBe(401);

    const allowed = await post(app, INITIALIZE, { "x-mcp-key": "secret" });
    expect(allowed.status).toBe(200);
    expect((await readJsonRpc(allowed)).id).toBe(1);
  });

  it("validates configured origins while allowing missing Origin headers", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP("/mcp", () => createTestServer(), {
      origin: "https://trusted.example",
    });

    const missing = await post(app, INITIALIZE);
    expect(missing.status).toBe(200);

    const allowed = await post(app, INITIALIZE, {
      origin: "https://trusted.example",
    });
    expect(allowed.status).toBe(200);

    const rejected = await post(app, INITIALIZE, {
      origin: "https://evil.example",
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32000 },
      id: null,
    });

    const opaque = await post(app, INITIALIZE, { origin: "null" });
    expect(opaque.status).toBe(403);
  });

  it("responds 405 to GET and DELETE while accepting POST", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP("/mcp", () => createTestServer());

    const plainGet = await app.test(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: { accept: "application/json" },
      }),
    );
    expect(plainGet.status).toBe(405);

    // With an SSE Accept header Rossa dispatches EVENT, which must still 405.
    const sseGet = await app.test(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: { accept: "text/event-stream" },
      }),
    );
    expect(sseGet.status).toBe(405);

    const deleted = await app.test(
      new Request("http://localhost/mcp", { method: "DELETE" }),
    );
    expect(deleted.status).toBe(405);
  });

  it("mounts under the app base path", async () => {
    const app = new Rossa({ Encoding: "none", basePath: "/api" });
    app.registerMCP("/mcp", () => createTestServer());

    const mounted = await post(
      app,
      INITIALIZE,
      {},
      "http://localhost/api/mcp",
    );
    expect(mounted.status).toBe(200);

    const outsideBasePath = await post(
      app,
      INITIALIZE,
      {},
      "http://localhost/mcp",
    );
    expect(outsideBasePath.status).toBe(404);
  });

  it("replaces MCP re-registrations and rejects HTTP route collisions", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP("/mcp", () => createTestServer("first"));
    app.registerMCP("/mcp", () => createTestServer("second"));
    expect(app.httpRoutes).toHaveLength(1);

    const listed = await post(app, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
      params: {},
    });
    expect((await readJsonRpc(listed)).result.tools[0].name).toBe("second");

    const afterHttp = new Rossa({ Encoding: "none" });
    afterHttp.register(HttpMcpController);
    expect(() =>
      afterHttp.registerMCP("/mcp", () => createTestServer()),
    ).toThrow(/already registered as an HTTP route/);

    const afterMcp = new Rossa({ Encoding: "none" });
    afterMcp.registerMCP("/mcp", () => createTestServer());
    expect(() => afterMcp.register(HttpMcpController)).toThrow(
      /Duplicate http route collision/,
    );
  });
});

@route("/mcp")
class HttpMcpController extends Methods {
  get({ res }: ctx): Response {
    return res.text("http route");
  }
}
