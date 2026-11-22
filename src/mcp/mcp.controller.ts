import type { McpServer } from "@modelcontextprotocol/server";

/**
 * Base class for decorator-driven MCP endpoints.
 *
 * The framework creates a fresh `McpServer` for each request (named after the
 * controller class) and calls {@link McpController.build} before serving it.
 * Combine it with the `@mcp("/path")` decorator and register it with
 * `app.registerMCP(MyController)`.
 */
export abstract class McpController {
  /**
   * Builds the MCP server: register tools, resources, and prompts here.
   * Runs once per request via the SDK factory, so async setup is supported.
   */
  abstract build(server: McpServer): void | Promise<void>;
}
