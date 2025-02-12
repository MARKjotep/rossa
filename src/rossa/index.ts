import { Auth } from "authored";
import { Formula } from "./formula";
import { createIndex, dev, ServerCall } from "../server";
import { initEnv } from "../@/bun";
import { config } from "dotenv";
import { S } from "../session";
import { Serve, WebSocketHandler } from "bun";
import { $$, obj } from "../@";

export interface yveOptions {
  dir?: string;
  appDir?: string;
  envPath?: string;
  session?: Auth;
}

type _server = (
  server?: Partial<Serve> & dev,
  wss?: Partial<WebSocketHandler>,
) => void;

export class Rossa extends Formula {
  index: (server?: dev) => void;
  serve: _server;
  constructor(options: yveOptions = {}) {
    super(".", options);
    const { envPath, appDir, session } = options;
    const PRIV = this.dir + "/.private";

    initEnv(PRIV, envPath);

    config({ path: (envPath ? envPath : PRIV) + "/.env" });

    // init session provider here

    const SH = session ?? new Auth({ dir: this.dir });

    S.init(SH);
    // what if Session is included in the app instead??

    this.index = async (server: dev = {}) => {
      server.path = server.path || "/";
      await createIndex(server, this.apt);

      const dt = new Date().toLocaleTimeString();
      $$.p = `index @ ${dt}`;
    };

    this.serve = async (
      server: Partial<Serve> & dev = {},
      wss?: Partial<WebSocketHandler>,
    ) => await ServerCall.call(this, { server, wss });
  }
}
