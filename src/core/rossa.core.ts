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

//-- Types

export interface dev {
  path?: string;
  hostname?: string;
  method?: string;
  port?: number;
}

export interface serverOptions {
  server: Partial<Bun.Serve.Options<any, never>> &
    dev & { fn?: (port: number) => void };
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
      return await runGlobalPipeline();
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

    if (ffn) {
      ffn(_port);
    } else {
      const protocol = _server.tls ? "https" : "http";
      log.i = `${protocol}://localhost:${SV.port ?? _port}`;
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
