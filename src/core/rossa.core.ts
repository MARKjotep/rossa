import { ctx } from "@/http/ctx";
import { Req } from "@/http/req";
import { Res } from "@/http/res";
import type { ContentEncodingType } from "@/http/res/res.compressor";
import { Methods, route, RouterManager } from "@/router";
import type { methodsKeys } from "@/router/methods.router";
import { log } from "@ohmyqt/u";
import type { WebSocketHandler } from "bun";
import { StaticFileServer } from "./static-server";
import { dirname, isAbsolute, join } from "path";
import { logger, loggerFN } from "@/guard/logger.guard";
import {
  createSocketConfig,
  type WssMessageRateLimit,
  type wssMessage,
} from "@/wss/config.wss";
import {
  createMcpControllerFactory,
  createMcpRoute,
  getMcpMeta,
  McpController,
  type McpOptions,
  type McpServerFactory,
} from "@/mcp";

//-- Types

export interface dev {
  path?: string;
  hostname?: string;
  method?: string;
  port?: number;
}

export interface serverOptions {
  server: Partial<Bun.Serve.Options<any, never>> &
    dev & {
      /**
       * Called after Bun has bound the server, so `port` is the port actually
       * in use (including an OS-assigned ephemeral port when `port: 0`).
       *
       * The second argument is the bound `Bun.Server`; its `url` reflects the
       * effective host, port, and `https` scheme when `tls` is set.
       */
      fn?: (port: number, server: Bun.Server<any>) => void;
    };
  wss?: RossaWebSocketOptions | undefined;
}

export type RossaWebSocketOptions = Partial<WebSocketHandler<any>> & {
  /** Optional fixed-window incoming message limit applied separately per socket. */
  messageRateLimit?: WssMessageRateLimit;
};

export interface RossaOptions {
  basePath?: string;
  clientPath?: string;
  dirPath?: string;

  /** Additional static-file extensions to recognize, with or without a leading dot. */
  fileExtensions?: string[];
  logError?: boolean | undefined;
  Encoding?: ContentEncodingType;
}

//-- Rossa

/**
 * Turns a pipeline result into a `Response`.
 *
 * Guards and handlers are expected to return a `Response`. When a guard factory
 * is mounted without invoking it (`@use(createGuard(...))` instead of
 * `@use(createGuard(...)(...))`), the factory is called with `(ctx, next)` and
 * returns the inner interceptor. Bun would then serve its default page, so this
 * check answers with an explicit 500 instead.
 */
function asResponse(value: unknown): Response {
  if (value instanceof Response) return value;

  console.error(
    "[rossa] Guard factory not invoked? Expected a Response but got:",
    value,
  );
  return new Response("Internal Server Error: guard factory not invoked", {
    status: 500,
  });
}

export class Rossa extends RouterManager {
  protected options: Omit<Required<RossaOptions>, "fileExtensions">;
  declare fileServer: StaticFileServer;
  private clientRoot: string;
  constructor(options: RossaOptions = {}) {
    super(options.basePath || "");

    this.options = {
      basePath: options.basePath || "",
      clientPath: options.clientPath || "./public",
      dirPath: options.dirPath || "./src", // The location where the server is anchored
      logError: Boolean(options.logError),
      Encoding: options.Encoding || "br",
    };

    // Static file server here.

    this.clientRoot = this.getClientRoot;

    this.fileServer = new StaticFileServer(
      this.clientRoot,
      options.fileExtensions || [],
    );
  }

  /**
   * Mounts an MCP server over Streamable HTTP.
   *
   * Use the decorator idiom for controllers:
   * ```ts
   * @mcp("/mcp")
   * class MyMcp extends McpController {
   *   build(server: McpServer) { ... }
   * }
   * app.registerMCP(MyMcp);
   * ```
   *
   * A raw per-request factory remains available when an explicit path is
   * supplied: `app.registerMCP("/mcp", () => new McpServer(...))`.
   *
   * Decorator-provided options are merged with per-call options; a per-call
   * `origin` wins. Global guards added with `use(...)` run before the MCP
   * handler. Registering the same path again replaces the previous MCP route.
   *
   * @param controller - A decorated `McpController` class or instance.
   * @param options - Optional per-call MCP settings.
   */
  registerMCP(controller: McpController, options?: McpOptions): void;
  registerMCP(
    controller: new () => McpController,
    options?: McpOptions,
  ): void;
  /**
   * Mounts a raw MCP factory at an explicit path.
   *
   * @param path - MCP endpoint path, for example `/mcp`.
   * @param factory - Produces the `McpServer` served for each request.
   * @param options - Optional allowed browser origins.
   */
  registerMCP(
    path: string,
    factory: McpServerFactory,
    options?: McpOptions,
  ): void;
  registerMCP(
    controllerOrPath: McpController | (new () => McpController) | string,
    factoryOrOptions: McpServerFactory | McpOptions = {},
    options: McpOptions = {},
  ): void {
    if (typeof controllerOrPath === "string") {
      const factory = factoryOrOptions as McpServerFactory;
      if (typeof factory !== "function") {
        throw new TypeError(
          "[MCP Error] registerMCP(path, factory) requires an McpServerFactory function.",
        );
      }

      this.mountMcp(controllerOrPath, factory, options);
      return;
    }

    const isInstance = controllerOrPath instanceof McpController;
    const ControllerClass = isInstance
      ? controllerOrPath.constructor
      : controllerOrPath;

    const meta = getMcpMeta(ControllerClass);
    if (!meta) {
      throw new Error(
        `[MCP Error] ${ControllerClass.name || "Controller"} is missing the @mcp decorator. ` +
          `Decorate it with @mcp("/path") or register it with an explicit path and factory.`,
      );
    }

    const controller = isInstance
      ? controllerOrPath
      : new (controllerOrPath as new () => McpController)();

    const callOptions = factoryOrOptions as McpOptions;
    const mergedOptions: McpOptions = {
      ...meta.options,
      ...(callOptions.origin !== undefined
        ? { origin: callOptions.origin }
        : {}),
    };

    this.mountMcp(
      meta.path,
      createMcpControllerFactory(controller),
      mergedOptions,
    );
  }

  private mountMcp(
    path: string,
    factory: McpServerFactory,
    options: McpOptions,
  ): void {
    const handler = createMcpRoute(factory, options);

    this.registerHandlerRoute(
      path,
      {
        POST: handler,
        GET: handler,
        DELETE: handler,
        EVENT: handler,
      },
      { replace: true },
    );
  }

  private get getClientRoot() {
    let resolvedAssetDiskRoot: string;

    if (isAbsolute(this.options.clientPath)) {
      resolvedAssetDiskRoot = this.options.clientPath;
    } else {
      const absoluteDirAnchor = isAbsolute(this.options.dirPath)
        ? this.options.dirPath
        : join(process.cwd(), this.options.dirPath);

      const projectRootDirectory = dirname(absoluteDirAnchor);

      resolvedAssetDiskRoot = join(
        projectRootDirectory,
        this.options.clientPath,
      );
    }

    return resolvedAssetDiskRoot;
  }

  // --- Pipelines ---------------------------------------------------------------

  private async pipeline(ctx: ctx) {
    let globalIndex = 0;
    const runGlobalPipeline = async (): Promise<Response> => {
      // If the global chain finishes successfully, hand the request off to the Router!
      if (globalIndex >= this.globalGuards.length) {
        return await this.processRouter(ctx);
      }
      const nextMiddleware = this.globalGuards[globalIndex++]!;
      return await nextMiddleware(ctx, runGlobalPipeline);
    };

    try {
      return asResponse(await runGlobalPipeline());
    } catch (error: any) {
      return this.errorHandler(ctx.res, error);
    }
  }

  private async processRouter(ctx: ctx) {
    //

    const parsedUrl = ctx.req.url;
    const method = ctx.req.method as methodsKeys;

    let currentPathname = parsedUrl.pathname;
    if (currentPathname.endsWith("/") && currentPathname.length > 1) {
      currentPathname = currentPathname.slice(0, -1);
    }

    // STEP A: Intercept WebSocket Upgrade Requests

    if (ctx.req.isWSS) {
      return this.processWSS(ctx, currentPathname);
      // return the websocket object
    }

    // --- Get the path ---------------------------------------------------------------

    const _method = ctx.req.isEventStream ? "EVENT" : method;

    const {
      guards = [],
      handler,
      params,
      methodKeys = [],
      controller,
    } = this.match(_method, currentPathname);

    if (!handler) return ctx.res.null(404);

    ctx.params = params;
    ctx.method = _method;
    ctx.methods = methodKeys;

    let localIndex = 0;

    const runLocalPipeline = async (): Promise<Response> => {
      if (localIndex >= guards.length) {
        // Execute the resolved handler
        return await handler(ctx);
      }
      const nextLocalWrapper = guards[localIndex++]!;

      return await nextLocalWrapper(ctx, runLocalPipeline);
    };

    // ---  ---------------------------------------------------------------

    return await runLocalPipeline();
  }

  private async processWSS(ctx: ctx, _path: string) {
    const { instance, guards = [], params = {} } = this.matchWSS(_path) || {};

    //
    if (!instance) return ctx.res.error(404, "WebSocket Route Not Found.");

    ctx.params = params;

    let localIndex = 0;
    const runLocalPipeline = async (): Promise<Response> => {
      if (localIndex >= guards.length) {
        const _CLASS = new instance();

        const upgradeSuccess = ctx.req.server?.upgrade(ctx.req.request, {
          data: {
            instance: _CLASS,
            contextData: ctx.data,
          },
        });

        if (upgradeSuccess) return ctx.res.null(200);

        return ctx.res.error(500, "WebSocket Upgrade Failed");
      }
      const nextLocalWrapper = guards[localIndex++]!;

      return await nextLocalWrapper(ctx, runLocalPipeline);
    };

    // ---  ---------------------------------------------------------------

    return await runLocalPipeline();
  }

  // --- Tester ---------------------------------------------------------------

  async test(req: Request, encoding?: ContentEncodingType) {
    // this.compileRoutesList();

    const NC = new ctx(
      new Res(
        { encoding: encoding ?? this.options.Encoding },
        new Req(req, undefined, this.fileServer.isFile.bind(this.fileServer)),
        this.fileServer,
      ),
    );

    NC.clientDirectory = this.clientRoot;
    return await this.pipeline(NC);
  }
  // --- Main ---------------------------------------------------------------

  /**
   * Starts a Bun server for the app.
   *
   * Server options are passed directly (`port`, `hostname`, `tls`, ...). The
   * returned `Bun.Server` is already bound. When `fn` is supplied it runs after
   * binding and receives the bound port and server, so `port: 0` resolves to
   * the OS-assigned port. Without `fn`, the startup log prints the bound URL
   * (`server.url`), including `https` when `tls` is configured.
   *
   * @param server - Bun serve options plus the optional `fn` ready callback.
   * @param wss - Optional WebSocket handler options and message rate limit.
   * @returns The bound `Bun.Server` instance.
   */
  serve(server: serverOptions["server"] = {}, wss: serverOptions["wss"] = {}) {
    const { fn, port, ..._server } = server;
    const { messageRateLimit, ...websocketOptions } = wss;
    const ffn = fn;

    const _port = port ?? 3000;

    const SV = Bun.serve({
      ...(_server as any),
      port: _port,
      // Extract the server instance natively to allow global IP tracking
      fetch: async (request: Request, server: Bun.Server<any>) => {
        const _ctx = new ctx(
          new Res(
            { encoding: this.options.Encoding },
            new Req(
              request,
              server,
              this.fileServer.isFile.bind(this.fileServer),
            ),
            this.fileServer,
            server,
          ),
        );

        _ctx.clientDirectory = this.clientRoot;

        try {
          return await this.pipeline(_ctx);
        } catch (e: any) {
          return _ctx.res.error(500, e.message || "Internal Server Error");
        }
      },
      websocket: {
        ...websocketOptions,
        ...createSocketConfig(messageRateLimit),
      },
    });

    const boundPort = SV.port ?? _port;

    if (ffn) {
      // Report the bound endpoint, not the configured one: with `port: 0`
      // Bun assigns the real port only after `Bun.serve` returns.
      ffn(boundPort, SV);
    } else {
      const protocol = _server.tls ? "https" : "http";
      log.i = SV.url?.href ?? `${protocol}://localhost:${boundPort}`;
    }

    return SV;
  }

  // --- Misc ---------------------------------------------------------------

  protected errorHandler(res: Res, error: any) {
    if (this.options.logError) {
      console.error(error.message);
    }
    return res.null(500);
  }
}
