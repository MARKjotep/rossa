import { describe, expect, it } from "bun:test";
import {
  McpController,
  McpServer,
  Rossa,
  mcp,
} from "../../src/index";

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
    clientInfo: { name: "rossa-decorator-client", version: "1.0.0" },
  },
};

const LIST_TOOLS = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
};

function post(
  app: Rossa,
  body: unknown,
  path = "/mcp-decorated",
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.test(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...PROTOCOL_HEADERS, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

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

@mcp("/mcp-decorated")
class DecoratedEchoController extends McpController {
  build(server: McpServer) {
    server.registerTool(
      "decorated-echo",
      { description: "Decorated echo" },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
  }
}

@mcp("/mcp-async")
class AsyncBuildController extends McpController {
  async build(server: McpServer) {
    await Promise.resolve();
    server.registerTool(
      "async-echo",
      { description: "Async echo" },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
  }
}

@mcp("/mcp-origin", { origin: "https://decorator.example" })
class DecoratorOriginController extends McpController {
  build(server: McpServer) {
    server.registerTool(
      "origin-echo",
      { description: "Origin echo" },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
  }
}

class MissingDecoratorController extends McpController {
  build(server: McpServer) {
    void server;
  }
}

// @ts-expect-error McpController subclasses must implement build().
class MissingBuildController extends McpController {}

describe("MCP decorator controllers", () => {
  it("runs a decorated controller through initialize and tools/list", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP(DecoratedEchoController);

    const initialized = await post(app, INITIALIZE);
    expect(initialized.status).toBe(200);
    const init = await readJsonRpc(initialized);
    expect(init.result.serverInfo).toEqual({
      name: "DecoratedEchoController",
      version: "0.0.0",
    });

    const listed = await post(app, LIST_TOOLS);
    expect(listed.status).toBe(200);
    const list = await readJsonRpc(listed);
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      ["decorated-echo"],
    );
  });

  it("accepts a controller instance and reads its decorator metadata", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP(new DecoratedEchoController());

    const response = await post(app, INITIALIZE);
    expect(response.status).toBe(200);
    expect((await readJsonRpc(response)).result.serverInfo.name).toBe(
      "DecoratedEchoController",
    );
  });

  it("awaits an async build before serving", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP(AsyncBuildController);

    const listed = await post(app, LIST_TOOLS, "/mcp-async");
    expect(listed.status).toBe(200);
    const list = await readJsonRpc(listed);
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      ["async-echo"],
    );
  });

  it("throws a clear error when a controller lacks the @mcp decorator", () => {
    const app = new Rossa({ Encoding: "none" });
    expect(() => app.registerMCP(MissingDecoratorController)).toThrow(
      /MissingDecoratorController is missing the @mcp decorator/,
    );
  });

  it("lets per-call options override decorator options", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.registerMCP(DecoratorOriginController, {
      origin: "https://call.example",
    });

    const decoratorOrigin = await post(app, INITIALIZE, "/mcp-origin", {
      origin: "https://decorator.example",
    });
    expect(decoratorOrigin.status).toBe(403);

    const callOrigin = await post(app, INITIALIZE, "/mcp-origin", {
      origin: "https://call.example",
    });
    expect(callOrigin.status).toBe(200);

    const missingOrigin = await post(app, INITIALIZE, "/mcp-origin");
    expect(missingOrigin.status).toBe(200);
  });
});
