import {
  createMcpHandler,
  originValidationResponse,
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import type { ctx } from "@/http/ctx";
import type { McpController } from "./mcp.controller";

/**
 * Produces a fresh MCP server for one HTTP exchange. Under the SDK's v2
 * handler the factory runs once per request, so per-request tools are possible.
 * Zero-argument factories remain assignable.
 */
export type McpServerFactory = (
  context: McpRequestContext,
) => McpServer | Promise<McpServer>;

export interface McpOptions {
  /**
   * Allowed browser `Origin` values. Entries may be full origins
   * (`https://app.example.com`), plain hostnames (`app.example.com`), or
   * scheme wildcards (`https://*`, `http://*`, `moz-extension://*`). Full
   * origins are matched exactly (scheme, host, and port); hostnames are
   * matched port-agnostically, in either scheme.
   *
   * A scheme wildcard allows every origin that uses that scheme: `https://*`
   * admits any https origin but not http, and `http://*` the reverse. Rossa
   * matches the `http`/`https` forms itself because the underlying MCP SDK
   * wildcard rule only covers non-web schemes; extension wildcards such as
   * `moz-extension://*` are validated by the SDK as before.
   *
   * Requests without an `Origin` header always pass, as non-browser MCP
   * clients do not send one. When omitted, Origin validation is disabled;
   * production apps should set this or use the CORS and IP guards.
   */
  origin?: string | string[];
}

export type McpRequestHandler = (ctx: ctx) => Promise<Response>;

/**
 * Wraps an `McpController` instance in the per-request SDK factory. A fresh
 * server is created for every exchange, named after the controller class.
 */
export function createMcpControllerFactory(
  controller: McpController,
): McpServerFactory {
  return async () => {
    const server = new McpServer({
      name: controller.constructor.name || "McpController",
      version: "0.0.0",
    });
    await controller.build(server);
    return server;
  };
}

interface OriginAllowlist {
  /** Exact origins (scheme, host, port) matched by Rossa. */
  origins: Set<string>;
  /** `http:` / `https:` scheme wildcards matched by Rossa. */
  schemes: Set<string>;
  /** Hostname rules handed to the SDK validator (plain hosts + non-web wildcards). */
  hostnames: string[];
}

/** Matches a bare scheme wildcard such as `https://*` or `moz-extension://*`. */
const SCHEME_WILDCARD = /^([a-z][a-z0-9+.-]*):\/\/\*$/i;

function compileOrigins(origin: string | string[]): OriginAllowlist {
  const allowlist: OriginAllowlist = {
    origins: new Set(),
    schemes: new Set(),
    hostnames: [],
  };

  for (const entry of Array.isArray(origin) ? origin : [origin]) {
    const value = entry.trim();
    if (!value) continue;

    const wildcard = SCHEME_WILDCARD.exec(value);
    if (wildcard) {
      const scheme = `${wildcard[1]!.toLowerCase()}:`;
      // SDK 2.4.0 ignores web-scheme wildcards, so Rossa honours them itself.
      if (scheme === "http:" || scheme === "https:") {
        allowlist.schemes.add(scheme);
      } else {
        allowlist.hostnames.push(value);
      }
      continue;
    }

    try {
      allowlist.origins.add(new URL(value).origin);
    } catch {
      allowlist.hostnames.push(value);
    }
  }

  return allowlist;
}

function validateOrigin(
  request: Request,
  allowlist: OriginAllowlist,
): Response | undefined {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return undefined;

  try {
    const origin = new URL(originHeader);
    if (allowlist.origins.has(origin.origin)) return undefined;
    if (allowlist.schemes.has(origin.protocol)) return undefined;
  } catch {
    // Fall through to the SDK validator so malformed/opaque origins get a 403.
  }

  return originValidationResponse(request, allowlist.hostnames);
}

/**
 * Builds the Rossa route handler for an MCP endpoint. The returned function
 * receives the framework context, normalizes Origin policy, and delegates the
 * untouched web-standard request/response to the SDK handler so SSE streams
 * pass through unchanged.
 */
export function createMcpRoute(
  factory: McpServerFactory,
  options: McpOptions = {},
): McpRequestHandler {
  const handler = createMcpHandler(factory);
  const allowlist =
    options.origin === undefined ? undefined : compileOrigins(options.origin);

  return async (ctx) => {
    if (allowlist) {
      const rejected = validateOrigin(ctx.req.request, allowlist);
      if (rejected) return rejected;
    }

    return handler.fetch(ctx.req.request);
  };
}
