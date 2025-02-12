import { inflateSync, serve, Serve, WebSocketHandler, write } from "bun";
import { Rossa } from "../rossa";
import { socketConfig } from "../wss";
import { Runner } from "../runner";
import { getTLS } from "../@/bun";
import { $$ } from "../@";

/*
-------------------------
process the server call here
-------------------------
*/
export interface dev {
  path?: string;
  hostname?: string;
  method?: string;
  port?: number;
}

interface serverOptions {
  server: Partial<Serve> & dev;
  wss?: Partial<WebSocketHandler>;
}

export async function ServerCall(this: Rossa, options: serverOptions) {
  const { server, wss } = options;

  const SV = serve({
    ...server,
    ...(this._statics && { static: this._statics }),
    port: server.port || 3000,
    tls: getTLS(this.dir),
    fetch: async (req, server) => {
      //
      return await new Runner(req, server, this.apt).response();
    },
    websocket: {
      sendPings: true,
      perMessageDeflate: true,
      ...wss,
      ...socketConfig,
    },
  });

  const shutdown = () => {
    SV.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/*
-------------------------
Create HTML Index file for local live
-------------------------
*/
export const createIndex = async (
  server: serverOptions["server"],
  dir: string,
) => {
  let { path, hostname, method, port } = server;
  const CTX = await new Runner(
    {
      url: `http://${hostname ?? "127.0.0.1"}:${port || 3000}${path}`,
      method: method ?? "GET",
    } as Request,
    undefined,
    dir,
  ).response();

  const AB = await CTX.arrayBuffer();

  if (AB.byteLength) {
    write(dir + "/index.html", inflateSync(AB));
  }

  return;
};
