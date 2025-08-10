import { file, inflateSync, serve, Serve, WebSocketHandler, write } from "bun";
import { Rossa } from "../rossa";
import { socketConfig } from "../wss";
import { Runner } from "../runner";
import { getTLS } from "../@/bun";
import { log } from "../@";
import { dev } from "..";

/*
-------------------------
process the server call here
-------------------------
*/

interface serverOptions {
  server: Partial<Serve> & dev & { fn?: (port: number) => void };
  wss?: Partial<WebSocketHandler>;
}

export async function ServerCall(this: Rossa, options: serverOptions) {
  const { server, wss } = options;
  const ffn = server.fn;
  delete server.fn;

  const { key, cert } = getTLS(this.dir);

  const port = server.port || 3000;
  const SV = serve({
    ...server,
    ...(this._statics && { static: this._statics }),
    port,
    tls: {
      key: await key.text(),
      cert: await cert.text(),
    },
    fetch: async (req, server) => {
      //
      return await new Runner(req, server, this.apt, this.base).response();
    },
    websocket: {
      sendPings: true,
      perMessageDeflate: true,
      ...wss,
      ...socketConfig,
    },
  });

  ffn?.(port);

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
  server: serverOptions["server"] & { name?: string },
  dir: string,
  base: string = "",
) => {
  let { path, hostname, method, port, name } = server;
  const CTX = await new Runner(
    {
      url: `http://${hostname ?? "127.0.0.1"}:${port || 3000}${path}`,
      method: method ?? "GET",
    } as Request,
    undefined,
    dir,
  ).response();

  const AB = await CTX.arrayBuffer();
  const pslc = path?.slice(1);

  const inName = name ? `/${name}` : pslc ? "/" + pslc : "";

  const inP = inName.split("#")[0];

  if (AB.byteLength) {
    await write(dir + base + `${inP}/index.html`, inflateSync(AB));
  }

  return inP + "/index";
};
