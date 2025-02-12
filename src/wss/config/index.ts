import { ServerWebSocket } from "bun";
import { websocket } from "..";
import { obj, oKeys, oLen } from "../../@";
import { repsWSS } from "../storage";

export const socketConfig = {
  async open(
    ws: ServerWebSocket<{
      wclass: websocket;
      args: obj<string>;
      client: obj<repsWSS>;
    }>,
  ) {
    const WC = ws.data.wclass;
    const { args, client } = ws.data;
    if (WC) {
      WC.ws = ws;
      const cid = WC.id;
      const clen = oLen(client);
      if (!(cid in client)) {
        const role = clen ? "joiner" : "maker";
        client[cid] = {
          role: role,
        };
      }

      if (typeof WC["init"] == "function") await WC.init(args);

      if (WC.broadcasting) {
        WC.ws.subscribe(WC.path);
      }

      await WC.open();
    } else {
      ws.close();
    }
  },
  async message(
    ws: ServerWebSocket<{ wclass: websocket; client: obj<repsWSS> }>,
    message: string | Buffer,
  ) {
    const WC = ws.data.wclass;
    if (WC) {
      await WC.message(message);
    }
  },
  async close(
    ws: ServerWebSocket<{ wclass: websocket; client: obj<repsWSS> }>,
    code: number,
    reason: string,
  ) {
    const WC = ws.data.wclass;
    const client = ws.data.client;
    if (WC) {
      await WC.close(code, reason);

      if (WC.broadcasting) {
        WC.ws.unsubscribe(WC.path);
      }

      const wid = WC.id;
      delete client[wid];

      if (oLen(client) === 1) {
        oKeys(client).forEach((c) => {
          client[c].role = "maker";
        });
      }
    }
  },
};
