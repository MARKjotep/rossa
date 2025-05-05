import { response, responses } from "..";
import { Runner } from "../../runner";
import { getPath } from "../../storage";
import { CTX } from "../context";

export async function ERROR(this: Runner) {
  const _pt = this.path;
  this.path = this.status.toString();

  const { serverPath, args, session } = await getPath.call(this, "error");

  this.path = _pt;
  if (!serverPath) return null;

  const { serverClass } = serverPath;

  if (!serverClass) return null;

  const F = new serverClass(this.request, args) as response;
  F.status = this.status;

  const { method } = this.request;

  if (F?.[method]) {
    const ctx = await F[method]();

    return this.compress("deflate", (await CTX.call(this, F, ctx, true)) ?? "");
  }

  return null;
}
