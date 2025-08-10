import { Auth } from "authored";
import { Formula } from "./formula";
import { createIndex, ServerCall } from "../server";
import { initEnv } from "../@/bun";
import { config } from "dotenv";
import { S } from "../session";
import { Serve, WebSocketHandler } from "bun";
import { log, obj } from "../@";
import { dev } from "..";

export interface yveOptions {
  dir?: string;
  clientDir?: string;
  envPath?: string;
  session?: Auth;
  base?: string;
}

export type for_srver = Partial<Serve> & dev & { fn?: (port: number) => void };

type _server = (
  server?: for_srver,
  wss?: Partial<WebSocketHandler>,
) => Promise<void>;

export class Rossa extends Formula {
  html: (server?: dev & { name?: string }) => Promise<void>;
  serve: _server;
  constructor(options: yveOptions = {}) {
    super(".", options);
    const { envPath, session } = options;
    const PRIV = this.dir + "/.private";

    initEnv(PRIV, envPath);

    config({ path: (envPath ? envPath : PRIV) + "/.env" });

    // init session provider here

    const SH = session ?? new Auth({ dir: this.dir });

    S.init(SH);
    // what if Session is included in the app instead??

    this.html = async (server: dev & { name?: string } = {}) => {
      server.path = this._base(server.path || "/");

      const nm = await createIndex(server, this.apt, this.base);

      const dt = new Date().toLocaleTimeString();

      log.i = `${nm}.html @ ${dt}`;
    };

    this.serve = async (
      server: for_srver = {},
      wss?: Partial<WebSocketHandler>,
    ) => await ServerCall.call(this, { server, wss });

    this.folders("/");
  }
}
