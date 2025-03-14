import { Auth } from "authored";
import { Formula } from "./formula";
import { createIndex, dev, ServerCall } from "../server";
import { initEnv } from "../@/bun";
import { config } from "dotenv";
import { S } from "../session";
import { Serve, WebSocketHandler } from "bun";
import { $$, obj } from "../@";

export interface yveOptions {
  root?: string;
  appDir?: string;
  envPath?: string;
  session?: Auth;
  base?: string;
}

type _server = (
  server?: Partial<Serve> & dev,
  wss?: Partial<WebSocketHandler>,
) => void;

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
      $$.p = `${nm}.html @ ${dt}`;
    };

    this.serve = async (
      server: Partial<Serve> & dev = {},
      wss?: Partial<WebSocketHandler>,
    ) => await ServerCall.call(this, { server, wss });
  }
}
