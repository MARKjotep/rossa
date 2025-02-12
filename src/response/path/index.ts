import { response } from "..";
import { FILE } from "../file";
import { responseBody, Runner } from "../../runner";
import { getPath } from "../../storage";
import { CTX } from "../context";
import { ESTREAM } from "../estream";
import { $$, oAss } from "../../@";

export async function PATH(this: Runner): Promise<responseBody> {
  const { serverPath, args, session } = await getPath.call(this, "path");

  if (!serverPath) return this.request.isFile ? FILE.call(this) : null;

  const { serverClass } = serverPath;

  if (!serverClass) return null;

  const F = new serverClass(this.request, args) as response;

  session && F.setServerSession(session);

  const { isEventStream, method } = this.request;

  if (isEventStream && F?.eventStream) {
    return ESTREAM.call(this, F, args, F.eventStream);
  }

  if (method === "options") {
    this.status = 204;
    return this.options(serverPath.options);
  }

  if (F?.[method]) {
    const ctx = await F[method]();
    this.status = 200;
    return this.compress("deflate", (await CTX.call(this, F, ctx)) ?? "");
  }

  return null;
}
