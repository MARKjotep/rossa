import { Runner, responseBody } from "../../runner";
import { getPath, wssConfig } from "../../storage";
import { getClient, websocket } from "..";

export async function UPGRADE(this: Runner): Promise<responseBody> {
  //
  const { serverPath, args, session } = await getPath.call(this, "wss");

  if (!serverPath) {
    this.status = 426;
    return "upgrade error";
  }

  const { serverClass } = serverPath;

  if (!serverClass) return "upgrade error";

  const webSocket = new serverClass(this.request) as websocket;

  session && webSocket.setServerSession(session);

  const clientPath = webSocket.path;
  const clients = getClient(clientPath);
  const clientCount = clients?.size ?? 0;

  const { broadcast, maxClient } = serverPath.config as wssConfig;

  webSocket.broadcasting = !!broadcast;
  webSocket.max = maxClient ?? 0;

  if (maxClient && clientCount >= maxClient) {
    this.status = 400;
    return "upgrade error";
  }

  this.request.upgradeConnection({
    data: {
      wclass: webSocket,
      args,
      client: clients,
    },
  });

  return null;
}
