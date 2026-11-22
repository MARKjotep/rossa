import { Refl } from "@ohmyqt/u";
import type { McpController } from "./mcp.controller";
import type { McpOptions } from "./mcp.http";

export const MCP_KEY = "rossa:mcp";

/** Metadata attached to a class by the `@mcp` decorator. */
export interface McpRouteMeta {
  path: string;
  options?: McpOptions;
}

/** Reads the `@mcp` metadata recorded for a controller class. */
export function getMcpMeta(target: Function): McpRouteMeta | undefined {
  const entries = Refl.get.class(MCP_KEY, target) as McpRouteMeta[];
  return entries.at(-1);
}

/**
 * Marks an {@link McpController} subclass as an MCP endpoint.
 *
 * @param path - MCP endpoint path, resolved under the app's `basePath`.
 * @param options - Optional MCP endpoint settings such as allowed origins.
 * @returns A class decorator, used as `@mcp("/mcp")`.
 */
export function mcp(path: string = "/", options: McpOptions = {}) {
  return Refl.decorateClass<McpController, McpRouteMeta>(MCP_KEY, () => ({
    path,
    options: { ...options },
  }));
}
